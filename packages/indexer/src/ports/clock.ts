export interface ClockPort {
  now(): number;
}

export const systemClock: ClockPort = { now: () => Date.now() };

/** Lets time-dependent rules (attention, debouncing) be tested without waiting. */
export class FakeClock implements ClockPort {
  constructor(private current = 0) {}
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    this.current += ms;
  }
  set(ms: number): void {
    this.current = ms;
  }
}
