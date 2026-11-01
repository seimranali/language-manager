import { getContainer } from "@/container";
import { getPrisma } from "@/infrastructure/database/prisma";

async function main() {
  const { factory, languageService } = getContainer();
  for (const name of factory.names()) {
    console.log(`${name}: ${await languageService.syncFrom(factory.get(name))} languages`);
  }
  await getPrisma().$disconnect();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
