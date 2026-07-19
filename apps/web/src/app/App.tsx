import { Route, Routes } from 'react-router-dom';
import { Backdrop } from '@/ui/Backdrop';
import { useConnectionLifecycle } from '@/net/useConnection';
import { LandingScreen } from '@/features/landing/LandingScreen';
import { NotFoundScreen } from '@/features/landing/NotFoundScreen';

export function App() {
  useConnectionLifecycle();

  return (
    <>
      <Backdrop />
      <div className="relative min-h-full">
        <Routes>
          <Route path="/" element={<LandingScreen />} />
          <Route path="*" element={<NotFoundScreen />} />
        </Routes>
      </div>
    </>
  );
}
