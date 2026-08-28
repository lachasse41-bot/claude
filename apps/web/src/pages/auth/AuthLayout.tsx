import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';

export function AuthLayout({
  title, subtitle, children, footer,
}: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth-backdrop flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-[10px] bg-[var(--accent)] text-white">
            <Sparkles className="size-4.5" aria-hidden />
          </span>
          <span className="text-[17px] font-semibold">Nova Studio</span>
        </div>

        <div
          className="surface animate-fade-up p-6"
          style={{ boxShadow: 'var(--shadow-pop)' }}
        >
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1.5 text-[13px] text-secondary-fg">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
        </div>

        {footer ? <div className="mt-5 text-center text-[13px] text-secondary-fg">{footer}</div> : null}
      </div>
    </div>
  );
}
