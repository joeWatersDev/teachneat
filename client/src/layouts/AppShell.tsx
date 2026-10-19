import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-full bg-base text-primary">
      <TopBar onToggleSidebar={() => setSidebarOpen((v) => !v)} />
      <Sidebar open={sidebarOpen} onDismiss={() => setSidebarOpen(false)} />

      {/* Main content: offset top for the top bar, offset left for the sidebar (tablet/desktop).
          `overflow-x-clip` is the backstop for absolutely positioned decoration
          (tooltip bubbles, popovers) near the right edge: it contributes to the
          document's scrollable width even while invisible, and a document wider
          than the viewport displaces the top bar and pushes the fixed sidebar's
          footer out of reach. `clip` rather than `hidden` deliberately — `hidden`
          would make this a scroll container and break `position: sticky` in the
          History grid and the Statistics table. Fixed-position descendants
          (modals) are not clipped, since `main` is not their containing block. */}
      <main className="min-h-screen overflow-x-clip bg-surface pt-16 md:pl-16 lg:pl-[220px]">
        <div className="mx-auto max-w-[1200px] px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
