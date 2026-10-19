import { AsyncWorkScope } from "./async-work-scope.js";

/** Retains accepted work across Gateway close handles and successor scope generations. */
export class GatewayRetainedWorkScope {
  private work = new AsyncWorkScope();
  private readonly scopes = new Set([this.work]);
  private gateways = 0;
  private closing = false;

  constructor(private readonly assertSettled?: () => void) {}

  get scope(): AsyncWorkScope {
    return this.work;
  }

  get isClosing(): boolean {
    return this.closing;
  }

  get hasGateways(): boolean {
    return this.gateways > 0;
  }

  reopen(): void {
    this.work = new AsyncWorkScope();
    this.scopes.add(this.work);
    this.closing = false;
  }

  private drain(scope: AsyncWorkScope): Promise<void> {
    return AsyncWorkScope.runWhenAllIdle(
      () => [scope],
      async () => {
        await scope.drain();
        this.assertSettled?.();
        this.scopes.delete(scope);
      },
    );
  }

  beginDrainAll(): Promise<void[]> {
    this.closing = true;
    return Promise.all([...this.scopes].map((scope) => this.drain(scope)));
  }

  retainGateway() {
    if (this.closing) {
      this.reopen();
    }
    this.gateways += 1;
    let released = false;
    let pending: Promise<void> | undefined;
    const beginClose = () => {
      if (!released) {
        released = true;
        if (--this.gateways === 0) {
          this.closing = true;
          pending = this.drain(this.work);
          void pending.catch(() => {});
        }
      }
    };
    return {
      beginClose,
      drain: () => {
        beginClose();
        return pending ?? Promise.resolve();
      },
    };
  }
}
