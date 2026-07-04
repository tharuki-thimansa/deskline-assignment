import { pool } from '../db';

export interface UserDto {
  id: number;
  name: string;
}

export async function findNameById(id: number): Promise<string | null> {
  const { rows } = await pool.query('select name from users where id = $1', [id]);
  return rows[0]?.name ?? null;
}

export async function listUsers(): Promise<UserDto[]> {
  const { rows } = await pool.query<UserDto>(
    'select id, name from users order by name asc'
  );
  return rows;
}
