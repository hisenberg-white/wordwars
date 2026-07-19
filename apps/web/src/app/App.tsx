import { Route, Routes } from 'react-router-dom';
import { Backdrop } from '@/ui/Backdrop';
import { useConnectionLifecycle } from '@/net/useConnection';
import { LandingScreen } from '@/features/landing/LandingScreen';
import { NotFoundScreen } from '@/features/landing/NotFoundScreen';
import { PENDING_ROUTES } from './routes';

export function App() {
  useConnectionLifecycle();

  return (
    <>
      <Backdrop />
      <div className="relative min-h-full">
        <Routes>
          <Route path="/" element={<LandingScreen />} />
          {PENDING_ROUTES.map(({ path, element }) => (
            <Route key={path} path={path} element={element} />
          ))}
          <Route path="*" element={<NotFoundScreen />} />
        </Routes>
      </div>
    </>
  );
}
