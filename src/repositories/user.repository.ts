import { Prisma, type PrismaClient, type User } from "@prisma/client";

export interface CreateUserData {
  firstName: string;
  lastName: string;
  gender: string;
  nativeLanguageCode: string;
  mobile?: string;
  email?: string;
  passwordHash: string;
}

export class UserRepository {
  constructor(private readonly db: PrismaClient) {}

  /** Returns null on a mobile collision; the unique index decides concurrent races. */
  async create(data: CreateUserData): Promise<User | null> {
    try {
      return await this.db.user.create({ data: { ...data, preferences: { create: {} } } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
      throw error;
    }
  }
  findById(id: string) {
    return this.db.user.findUnique({ where: { id } });
  }
  findByMobile(mobile: string) {
    return this.db.user.findUnique({ where: { mobile } });
  }
  findByEmail(email: string) {
    return this.db.user.findUnique({ where: { email } });
  }
  markEmailVerified(email: string) {
    return this.db.user.updateMany({ where: { email }, data: { isVerified: true, emailVerifiedAt: new Date() } });
  }
  update(id: string, data: Prisma.UserUpdateInput) {
    return this.db.user.update({ where: { id }, data });
  }
  async delete(id: string) {
    await this.db.user.delete({ where: { id } });
  }
  markVerified(mobile: string) {
    const now = new Date();
    return this.db.user.updateMany({ where: { mobile }, data: { isVerified: true, mobileVerifiedAt: now } });
  }
}
