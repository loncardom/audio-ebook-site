import { LandingView } from "./components/LandingView";
import { ReaderView } from "./components/ReaderView";
import { useReaderController } from "./hooks/useReaderController";

export default function App() {
  const controller = useReaderController();

  if (controller.routePath === "/reader") {
    return <ReaderView {...controller} />;
  }

  return <LandingView {...controller} />;
}
