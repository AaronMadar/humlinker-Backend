import type { Humlinker } from '../entities';

export interface HumlinkerRepository {
  findById(id: string): Promise<Humlinker | null>;
  create(humlinker: Humlinker): Promise<Humlinker>;
  update(id: string, humlinker: Partial<Humlinker>): Promise<Humlinker | null>;
}
