import { createDefaultActionService } from "../actions/ActionService";
import { createDefaultWorkflowService } from "./WorkflowService";

export const workflowService = createDefaultWorkflowService();
export const actionService = createDefaultActionService();
