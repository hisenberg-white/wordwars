import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { bindAudio, installAudioUnlock } from '@/audio/bindAudio';
import { authManager } from '@/net/AuthManager';
import { Backdrop } from '@/ui/Backdrop';
import { useConnectionLifecycle } from '@/net/useConnection';
import { LandingScreen } from '@/features/landing/LandingScreen';
import { NotFoundScreen } from '@/features/landing/NotFoundScreen';
import { PlayScreen } from '@/features/matchmaking/PlayScreen';
import { RoomEntryScreen } from '@/features/room/RoomEntryScreen';
import { RoomScreen } from '@/features/room/RoomScreen';
import { ProfileScreen } from '@/features/profile/ProfileScreen';
import { LeaderboardScreen } from '@/features/leaderboard/LeaderboardScreen';
import { FriendsScreen } from '@/features/friends/FriendsScreen';
import { ChallengeToast } from '@/features/friends/ChallengeToast';
import { PENDING_ROUTES } from './routes';

export function App() {
  useConnectionLifecycle();

  // Audio binds once for the app's lifetime and rides the same event stream as
  // the renderer, so sound can never drift out of sync with what is on screen.
  // Restores an account session from a stored token, if there is one.
  useEffect(() => {
    void authManager.restore();
  }, []);

  useEffect(() => {
    const offAudio = bindAudio();
    const offUnlock = installAudioUnlock();

    return () => {
      offAudio();
      offUnlock();
    };
  }, []);

  return (
    <>
      <Backdrop />
      <div className="relative min-h-full">
        <Routes>
          <Route path="/" element={<LandingScreen />} />
          <Route path="/play" element={<PlayScreen />} />
          <Route path="/room" element={<RoomEntryScreen />} />
          <Route path="/room/:code" element={<RoomScreen />} />
          <Route path="/profile" element={<ProfileScreen />} />
          <Route path="/leaderboard" element={<LeaderboardScreen />} />
          <Route path="/friends" element={<FriendsScreen />} />
          {PENDING_ROUTES.map(({ path, element }) => (
            <Route key={path} path={path} element={element} />
          ))}
          <Route path="*" element={<NotFoundScreen />} />
        </Routes>
      </div>

      {/* App-wide: a challenge is worthless if it only arrives when you happen
          to be looking at the friends screen. */}
      <ChallengeToast />
    </>
  );
}
