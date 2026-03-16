/**
 * 동시 실행 수를 제한하는 세마포어.
 * 최대 허용치를 초과하면 대기열에서 순서를 기다린다.
 */
export class Semaphore {
  private current = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new Error("Semaphore max must be >= 1");
  }

  /** 슬롯을 획득한다. 가용 슬롯이 없으면 대기한다. */
  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  /** 슬롯을 반환한다. 대기 중인 요청이 있으면 깨운다. */
  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  /** 현재 활성 슬롯 수 */
  get activeCount(): number {
    return this.current;
  }

  /** 대기 중인 요청 수 */
  get waitingCount(): number {
    return this.queue.length;
  }
}
