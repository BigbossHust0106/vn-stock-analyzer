import {
  defaultSettings,
  validateSettings,
  type ScoringSettings,
} from './scoring-settings';
export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
// Auth-derived owner stays in memory. Persisted owner IDs are never authority.
export class SessionPreferences {
  private owner: string | null = null;
  private expiresAt: number | null = null;
  private generation = 0;
  constructor(
    private storage: PreferenceStorage,
    private changed: () => void,
    private clock = Date.now,
  ) {}
  ownerId(): string | null {
    this.expire();
    return this.owner;
  }
  private expire() {
    if (this.expiresAt !== null && this.clock() >= this.expiresAt) {
      this.owner = null;
      this.expiresAt = null;
      this.generation++;
      this.changed();
    }
  }
  activate(owner: string | null, expiresAt: number | null) {
    const valid =
      owner !== null &&
      expiresAt !== null &&
      Number.isFinite(expiresAt) &&
      expiresAt > this.clock();
    const next = valid ? owner : null;
    if (next !== this.owner) {
      this.owner = next;
      this.generation++;
    }
    this.expiresAt = valid ? expiresAt : null;
    this.changed();
  }
  read(): ScoringSettings {
    this.expire();
    try {
      const value: unknown = JSON.parse(
        this.storage.getItem(
          'vn-stock-scoring-v1:' + (this.owner ?? 'guest'),
        ) ?? 'null',
      );
      return validateSettings(value) ? value : { ...defaultSettings };
    } catch {
      return { ...defaultSettings };
    }
  }
  write(
    settings: ScoringSettings,
    expectedOwner: string | null = this.ownerId(),
  ) {
    this.expire();
    if (expectedOwner !== this.owner)
      throw new Error(
        'Phiên đăng nhập đã thay đổi; không ghi cài đặt sai người dùng.',
      );
    if (!validateSettings(settings))
      throw new Error('Trọng số/giả định không hợp lệ.');
    this.storage.setItem(
      'vn-stock-scoring-v1:' + (this.owner ?? 'guest'),
      JSON.stringify(settings),
    );
    this.generation++;
    this.changed();
  }
  capture() {
    this.expire();
    return { owner: this.owner, generation: this.generation };
  }
  accept(
    settings: unknown,
    request: ReturnType<SessionPreferences['capture']>,
  ) {
    this.expire();
    if (
      request.owner === this.owner &&
      request.generation === this.generation &&
      validateSettings(settings)
    ) {
      this.write(settings, request.owner);
      return true;
    }
    return false;
  }
}
