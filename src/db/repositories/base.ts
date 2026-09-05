/**
 * テーブル共通の CRUD。UI からはこれを経由して DB に触る。
 * - list(): deleted=0 のみ
 * - remove(): ソフト削除（物理削除しない）
 */
import type { Table } from 'dexie';
import { newEntity, touch } from '../db';
import type { Entity, UUID } from '../schema';

export type NewRecord<T extends Entity> = Omit<T, keyof Entity>;

export function makeRepo<T extends Entity>(table: Table<T, UUID>) {
  return {
    table,

    async list(): Promise<T[]> {
      return table.where('deleted').equals(0).toArray();
    },

    async get(id: UUID): Promise<T | undefined> {
      const r = await table.get(id);
      return r && r.deleted === 0 ? r : undefined;
    },

    async create(data: NewRecord<T>): Promise<T> {
      const rec = { ...newEntity(), ...data } as T;
      await table.add(rec);
      return rec;
    },

    async update(id: UUID, patch: Partial<NewRecord<T>>): Promise<T> {
      const cur = await table.get(id);
      if (!cur) throw new Error(`record not found: ${id}`);
      const next = touch({ ...cur, ...patch }) as T;
      await table.put(next);
      return next;
    },

    async remove(id: UUID): Promise<void> {
      const cur = await table.get(id);
      if (!cur) return;
      await table.put(touch({ ...cur, deleted: 1 }) as T);
    },
  };
}
