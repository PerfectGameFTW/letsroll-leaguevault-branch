import { User, InsertUser, Bowler, InsertBowler, Payment, InsertPayment } from "@shared/schema";

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Bowlers
  getBowlers(): Promise<Bowler[]>;
  getBowler(id: number): Promise<Bowler | undefined>;
  createBowler(bowler: InsertBowler): Promise<Bowler>;
  updateBowler(id: number, bowler: Partial<InsertBowler>): Promise<Bowler>;
  deleteBowler(id: number): Promise<void>;

  // Payments
  getPayments(bowlerId?: number): Promise<Payment[]>;
  createPayment(payment: InsertPayment): Promise<Payment>;
  updatePaymentStatus(id: number, status: string, squarePaymentId?: string): Promise<Payment>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private bowlers: Map<number, Bowler>;
  private payments: Map<number, Payment>;
  private currentUserId: number;
  private currentBowlerId: number;
  private currentPaymentId: number;

  constructor() {
    this.users = new Map();
    this.bowlers = new Map();
    this.payments = new Map();
    this.currentUserId = 1;
    this.currentBowlerId = 1;
    this.currentPaymentId = 1;
  }

  // Users
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username
    );
  }

  async createUser(user: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const newUser = { ...user, id };
    this.users.set(id, newUser);
    return newUser;
  }

  // Bowlers
  async getBowlers(): Promise<Bowler[]> {
    return Array.from(this.bowlers.values());
  }

  async getBowler(id: number): Promise<Bowler | undefined> {
    return this.bowlers.get(id);
  }

  async createBowler(bowler: InsertBowler): Promise<Bowler> {
    const id = this.currentBowlerId++;
    const newBowler = { ...bowler, id };
    this.bowlers.set(id, newBowler);
    return newBowler;
  }

  async updateBowler(id: number, bowler: Partial<InsertBowler>): Promise<Bowler> {
    const existing = await this.getBowler(id);
    if (!existing) throw new Error("Bowler not found");
    const updated = { ...existing, ...bowler };
    this.bowlers.set(id, updated);
    return updated;
  }

  async deleteBowler(id: number): Promise<void> {
    this.bowlers.delete(id);
  }

  // Payments
  async getPayments(bowlerId?: number): Promise<Payment[]> {
    const payments = Array.from(this.payments.values());
    if (bowlerId) {
      return payments.filter(payment => payment.bowlerId === bowlerId);
    }
    return payments;
  }

  async createPayment(payment: InsertPayment): Promise<Payment> {
    const id = this.currentPaymentId++;
    const newPayment = { ...payment, id };
    this.payments.set(id, newPayment);
    return newPayment;
  }

  async updatePaymentStatus(id: number, status: string, squarePaymentId?: string): Promise<Payment> {
    const payment = this.payments.get(id);
    if (!payment) throw new Error("Payment not found");
    
    const updated = {
      ...payment,
      status,
      squarePaymentId,
      paidAt: status === "paid" ? new Date() : payment.paidAt,
    };
    
    this.payments.set(id, updated);
    return updated;
  }
}

export const storage = new MemStorage();
