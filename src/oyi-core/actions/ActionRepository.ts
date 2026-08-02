import type { OyiAction } from "../contracts/action";

export interface ActionRepository {
  get(actionId: string): Promise<OyiAction | null>;
  save(action: OyiAction): Promise<OyiAction>;
}

export class InMemoryActionRepository implements ActionRepository {
  private readonly actions = new Map<string, OyiAction>();
  async get(actionId: string) {
    return this.actions.get(actionId) || null;
  }
  async save(action: OyiAction) {
    this.actions.set(action.action_id, action);
    return action;
  }
}
