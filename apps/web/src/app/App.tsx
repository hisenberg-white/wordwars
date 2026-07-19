import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { bindAudio, installAudioUnlock } from '@/audio/bindAudio';
import { audio } from '@/audio/AudioEngine';
import { settingsManager } from '@/settings/SettingsManager';
import { roomManager } from '@/net/RoomManager';
import { connection } from '@/net/ConnectionManager';
import { audioSettingsOf } from '@/settings/settings';
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
import { SettingsScreen } from '@/features/settings/SettingsScreen';
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

    /*
     * Volume changes apply live.
     *
     * A settings screen where the slider only takes effect on the next match
     * is a settings screen you cannot actually tune by ear — the whole point of
     * dragging it is to hear the result.
     */
    const applyAudio = () => audio.update(audioSettingsOf(settingsManager.current));
    applyAudio();
    const offSettings = settingsManager.subscribe(applyAudio);

    /*
     * Listen for room state from the moment there is a socket.
     *
     * The server pushes rooms at the client unprompted — quick-match pairing, a
     * friend's challenge, and above all reconnecting into a match in progress,
     * which fires during `guest:init` before any screen has mounted. Attaching
     * these listeners when a screen asks for a room is too late: the player
     * comes back from a reload to a game that has already told them everything
     * they missed, and they sit on the menu while the server believes they are
     * mid-fight.
     */
    const listenForRooms = () => roomManager.listen();
    listenForRooms();
    const offConnection = connection.subscribe(listenForRooms);

    return () => {
      offAudio();
      offUnlock();
      offSettings();
      offConnection();
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
          <Route path="/settings" element={<SettingsScreen />} />
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
