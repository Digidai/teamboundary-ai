export class WorkflowEntrypoint<Environment = unknown, Payload = unknown> {
  protected env!: Environment;
  protected ctx!: ExecutionContext;
  protected payload!: Payload;
}
