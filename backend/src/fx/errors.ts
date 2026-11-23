export class FXError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class InvalidCurrencyCodeError extends FXError {}

export class InvalidFXAmountError extends FXError {}

export class FXSnapshotUnavailableError extends FXError {}

export class FXRateUnavailableError extends FXError {}

export class FXProviderError extends FXError {}
