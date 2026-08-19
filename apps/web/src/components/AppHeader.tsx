import Link from "next/link";

export function AppHeader() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/projects" className="flex items-center gap-2">
          <span className="text-lg font-semibold text-brand-700">HighLife</span>
          <span className="hidden text-sm text-slate-500 sm:inline">
            Floor Plan Analysis
          </span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/projects" className="text-slate-600 hover:text-brand-600">
            Projects
          </Link>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            Mock mode
          </span>
        </nav>
      </div>
    </header>
  );
}
