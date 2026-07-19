import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { bindAudio, installAudioUnlock } from '@/audio/bindAudio';
import { Backdrop } from '@/ui/Backdrop';
import { useConnectionLifecycle } from '@/net/useConnection';
import { LandingScreen } from '@/features/landing/LandingScreen';
import { NotFoundScreen } from '@/features/landing/NotFoundScreen';
import { PlayScreen } from '@/features/matchmaking/PlayScreen';
import { RoomEntryScreen } from '@/features/room/RoomEntryScreen';
import { RoomScreen } from '@/features/room/RoomScreen';
import { PENDING_ROUTES } from './routes';

export function App() {
  useConnectionLifecycle();

  // Audio binds once for the app's lifetime and rides the same event stream as
  // the renderer, so sound can never drift out of sync with what is on screen.
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
          {PENDING_ROUTES.map(({ path, element }) => (
            <Route key={path} path={path} element={element} />
          ))}
          <Route path="*" element={<NotFoundScreen />} />
        </Routes>
      </div>
    </>
  );
}
