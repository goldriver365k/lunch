import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Supabase 클라이언트. 환경변수가 없으면 null — 이때 소비자 앱은 가상 데이터(데모)로 동작하고
 * 관리자 페이지는 연결 안내를 보여준다.
 * 브라우저에는 anon 키만 쓴다. 권한은 DB의 RLS·is_admin()이 서버에서 검사한다.
 */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;
