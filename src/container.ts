import { getEnv } from "@/config/env";
import { RateLimiter } from "@/infrastructure/cache/rate-limiter";
import { createRedis, MemoryStore, RedisStore, type KeyValueStore } from "@/infrastructure/cache/store";
import { getPrisma } from "@/infrastructure/database/prisma";
import { logger } from "@/infrastructure/logging/logger";
import { BullJobQueue, type JobQueue } from "@/infrastructure/queue/queues";
import { ConsoleSmsSender, TwilioSmsSender, type SmsSender } from "@/infrastructure/sms/sms-sender";
import { HttpTelegramClient, type TelegramClient } from "@/infrastructure/telegram/telegram-client";
import { AuditService } from "@/modules/audit/audit.service";
import { AuthService } from "@/modules/auth/auth.service";
import { VerificationService } from "@/modules/auth/verification.service";
import { LanguageService } from "@/modules/languages/language.service";
import { MaintenanceService } from "@/modules/maintenance/maintenance.service";
import { TelegramLinkService } from "@/modules/telegram/telegram-link.service";
import { TelegramService } from "@/modules/telegram/telegram.service";
import type { TelegramUpdate } from "@/modules/telegram/telegram.validation";
import { ProviderSelector } from "@/modules/translations/provider-selector";
import { TranslationCacheService } from "@/modules/translations/translation-cache.service";
import { TranslationHistoryService } from "@/modules/translations/translation-history.service";
import { TranslationJobService } from "@/modules/translations/translation-job.service";
import { TranslationService } from "@/modules/translations/translation.service";
import { UserService } from "@/modules/users/user.service";
import { ClaudeTranslationProvider } from "@/providers/translation/claude-translation.provider";
import { GoogleApiKeyClient } from "@/providers/translation/google-api-key.client";
import { GoogleTranslationProvider } from "@/providers/translation/google-translation.provider";
import { ProviderGuard } from "@/providers/translation/provider-guard";
import { TranslationProviderFactory } from "@/providers/translation/translation-provider.factory";
import type { TranslationProvider } from "@/providers/translation/translation-provider.interface";
import { AuditLogRepository } from "@/repositories/audit-log.repository";
import { LanguageRepository } from "@/repositories/language.repository";
import { MaintenanceRepository } from "@/repositories/maintenance.repository";
import { ProviderUsageRepository } from "@/repositories/provider-usage.repository";
import { RefreshTokenRepository } from "@/repositories/refresh-token.repository";
import { SessionRepository } from "@/repositories/session.repository";
import { TelegramRepository } from "@/repositories/telegram.repository";
import { TranslationHistoryRepository } from "@/repositories/translation-history.repository";
import { TranslationJobRepository } from "@/repositories/translation-job.repository";
import { UserPreferenceRepository } from "@/repositories/user-preference.repository";
import { UserRepository } from "@/repositories/user.repository";
import { VerificationRepository } from "@/repositories/verification.repository";

export interface Overrides {
  providers?: TranslationProvider[];
  store?: KeyValueStore;
  queue?: JobQueue;
  sms?: SmsSender;
  telegramClient?: TelegramClient;
}

/** Runs queued work in this process when no Redis exists (development and tests only). */
class InlineJobQueue implements JobQueue {
  private running = 0;
  constructor(private readonly run: { translation: (id: string) => Promise<void>; telegram: (update: unknown) => Promise<void> }) {}

  private start(task: () => Promise<void>) {
    this.running += 1;
    setImmediate(() => {
      task().catch((error) => logger.error({ err: error }, "inline job failed")).finally(() => (this.running -= 1));
    });
  }
  async addTranslation(jobId: string) {
    this.start(() => this.run.translation(jobId));
  }
  async addTelegramUpdate(_id: string, update: unknown) {
    this.start(() => this.run.telegram(update));
  }
  async removeTranslation() {}
  async depth() {
    return this.running;
  }
}

function buildProviders(limiter: RateLimiter): TranslationProviderFactory {
  const env = getEnv();
  const shared = {
    queueLimit: env.PROVIDER_QUEUE_LIMIT,
    maxRetries: env.PROVIDER_MAX_RETRIES,
    failureThreshold: env.CIRCUIT_FAILURE_THRESHOLD,
    resetMs: env.CIRCUIT_RESET_MS,
  };
  const factory = new TranslationProviderFactory();
  if (env.GOOGLE_API_KEY || env.GOOGLE_CLOUD_PROJECT_ID) {
    const guard = new ProviderGuard({ ...shared, provider: "google", concurrency: env.GOOGLE_CONCURRENCY, ratePerMinute: env.GOOGLE_RATE_PER_MINUTE, timeoutMs: env.GOOGLE_TIMEOUT_MS }, limiter);
    factory.register(new GoogleTranslationProvider({ projectId: env.GOOGLE_CLOUD_PROJECT_ID ?? "", location: env.GOOGLE_CLOUD_LOCATION, timeoutMs: env.GOOGLE_TIMEOUT_MS, costPerMillionChars: env.GOOGLE_COST_PER_MILLION_CHARS_USD }, guard, env.GOOGLE_API_KEY ? new GoogleApiKeyClient(env.GOOGLE_API_KEY) : undefined));
  }
  if (env.ANTHROPIC_API_KEY) {
    const guard = new ProviderGuard({ ...shared, provider: "claude", concurrency: env.CLAUDE_CONCURRENCY, ratePerMinute: env.CLAUDE_RATE_PER_MINUTE, timeoutMs: env.CLAUDE_TIMEOUT_MS }, limiter);
    factory.register(new ClaudeTranslationProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL, effort: env.ANTHROPIC_EFFORT, maxTokens: env.ANTHROPIC_MAX_TOKENS, inputCostPerMTok: env.ANTHROPIC_INPUT_COST_PER_MTOK_USD, outputCostPerMTok: env.ANTHROPIC_OUTPUT_COST_PER_MTOK_USD }, guard));
  }
  return factory;
}

class NoTelegramClient implements TelegramClient {
  async sendMessage() {
    logger.warn("TELEGRAM_BOT_TOKEN is not set; message dropped");
    return undefined;
  }
  async editMessage() {}
  async sendTyping() {}
}

export function buildContainer(overrides: Overrides = {}) {
  const env = getEnv();
  const db = getPrisma();
  const redis = env.REDIS_URL ? createRedis(env.REDIS_URL) : undefined;
  const store = overrides.store ?? (redis ? new RedisStore(redis) : new MemoryStore(env.MEMORY_STORE_MAX_ENTRIES));
  const rateLimiter = new RateLimiter(store);

  const users = new UserRepository(db);
  const sessions = new SessionRepository(db);
  const preferences = new UserPreferenceRepository(db);
  const historyRepository = new TranslationHistoryRepository(db);
  const jobRepository = new TranslationJobRepository(db);
  const telegramRepository = new TelegramRepository(db);

  const audit = new AuditService(new AuditLogRepository(db));
  const languageService = new LanguageService(new LanguageRepository(db));
  const userService = new UserService(users, preferences, sessions, languageService, audit);
  const sms = overrides.sms ?? (env.VERIFICATION_PROVIDER === "twilio"
    ? new TwilioSmsSender({ accountSid: env.TWILIO_ACCOUNT_SID!, authToken: env.TWILIO_AUTH_TOKEN!, from: env.TWILIO_FROM_NUMBER! })
    : new ConsoleSmsSender());
  const verificationService = new VerificationService(new VerificationRepository(db), users, sms);
  const authService = new AuthService(users, new RefreshTokenRepository(db), sessions, userService, languageService, verificationService, audit);

  const factory = overrides.providers
    ? overrides.providers.reduce((f, p) => f.register(p), new TranslationProviderFactory())
    : buildProviders(rateLimiter);

  const cache = new TranslationCacheService(store);
  const historyService = new TranslationHistoryService(historyRepository);
  const translationService = new TranslationService(new ProviderSelector(factory), cache, historyService, languageService, preferences, new ProviderUsageRepository(db), store, users);

  const telegramClient = overrides.telegramClient ?? (env.TELEGRAM_BOT_TOKEN ? new HttpTelegramClient(env.TELEGRAM_BOT_TOKEN) : new NoTelegramClient());

  const handlers: { job?: TranslationJobService; telegram?: TelegramService } = {};
  const queue = overrides.queue ?? (redis
    ? new BullJobQueue(redis, env.JOB_MAX_ATTEMPTS)
    : new InlineJobQueue({
        translation: (id) => handlers.job!.process(id, env.JOB_MAX_ATTEMPTS),
        telegram: (update) => handlers.telegram!.process(update as TelegramUpdate),
      }));

  const jobService = new TranslationJobService(jobRepository, queue, translationService);
  const linkService = new TelegramLinkService(telegramRepository, authService, telegramClient, audit);
  const telegramService = new TelegramService(telegramRepository, telegramClient, queue, translationService, historyService, userService, languageService, linkService);
  handlers.job = jobService;
  handlers.telegram = telegramService;

  return {
    store, rateLimiter, queue, factory,
    audit, authService, verificationService, userService, languageService,
    translationService, historyService, jobService, telegramService, linkService,
    maintenanceService: new MaintenanceService(new MaintenanceRepository(db), historyRepository, jobRepository),
  };
}

export type Container = ReturnType<typeof buildContainer>;

const holder = globalThis as unknown as { container?: Container };

export function getContainer(): Container {
  holder.container ??= buildContainer();
  return holder.container;
}

export function setContainerForTests(container: Container | undefined) {
  holder.container = container;
}
