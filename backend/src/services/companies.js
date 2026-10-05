import crypto from 'crypto';
import { supabase } from '../config/supabaseClient.js';
import { mirrorUpsert, mirrorDelete } from '../config/postgresClient.js';

// No 0/O or 1/I/L, so a code read out over the phone can't be misheard
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 8;

export const generateJoinCode = () =>
  Array.from({ length: JOIN_CODE_LENGTH }, () => JOIN_CODE_ALPHABET[crypto.randomInt(JOIN_CODE_ALPHABET.length)]).join('');

// People type codes in any case and with spaces or dashes ("abcd-1234")
export const normalizeJoinCode = (code) => (typeof code === 'string' ? code.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');

export async function findCompanyByJoinCode(code) {
  const joinCode = normalizeJoinCode(code);
  if (!joinCode) return null;
  const { data, error } = await supabase.from('companies').select('id, name').eq('join_code', joinCode).maybeSingle();
  if (error) throw error;
  return data;
}

export async function findCompany(id) {
  const { data, error } = await supabase.from('companies').select('id, name, join_code, created_at').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

// Codes are random, so a clash is very unlikely; retry a few times rather than fail
async function withFreshCode(write) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await write(generateJoinCode());
    if (!error) {
      await mirrorUpsert('companies', data);
      return data;
    }
    if (error.code !== '23505') throw error; // anything but a unique-violation is a real error
  }
  throw new Error('Could not create a unique join code, please try again');
}

export const createCompany = (name) =>
  withFreshCode((join_code) => supabase.from('companies').insert([{ name, join_code }]).select().single());

// A new code stops the old one working, e.g. after it was shared too widely
export const regenerateJoinCode = (companyId) =>
  withFreshCode((join_code) => supabase.from('companies').update({ join_code }).eq('id', companyId).select().single());

// Undoes createCompany when the founding admin's account can't be created
export async function deleteCompany(id) {
  const { data } = await supabase.from('companies').delete().eq('id', id).select('id');
  await mirrorDelete('companies', data);
}
