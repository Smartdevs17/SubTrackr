export default class KeyStore {
  private current: string;
  private previous: string | null;

  constructor(initialKey: string) {
    this.current = initialKey;
    this.previous = null;
  }

  getActiveKeys(): string[] {
    if (this.previous) return [this.current, this.previous];
    return [this.current];
  }

  rotate(newKey: string) {
    this.previous = this.current;
    this.current = newKey;
  }

  setKeys(current: string, previous: string | null) {
    this.current = current;
    this.previous = previous;
  }

  getCurrent() {
    return this.current;
  }
}
