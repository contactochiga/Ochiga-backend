import "express";

declare global {
  namespace Express {
    interface User {
      id: string;
      role: "resident" | "manager" | "operator";
      estateId?: string;
      homeId?: string;
    }

    interface Request {
      user?: User;
    }
  }
}

export {};
