import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Profile } from '../storage/profiles';

export interface ProfileCtx {
  active: Profile;
  profiles: Profile[];
  switchTo: (id: string) => Promise<void>;
  add: (name: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
}

export const ProfileContext = createContext<ProfileCtx>(null as unknown as ProfileCtx);
export const useProfiles = () => useContext(ProfileContext);

/** First letter for the avatar circle. */
export const initial = (name: string) => [...name.trim()][0]?.toLocaleUpperCase() ?? '?';
