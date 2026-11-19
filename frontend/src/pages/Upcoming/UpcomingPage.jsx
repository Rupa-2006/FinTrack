import { Hammer } from 'lucide-react';
import { Badge, Button, Card } from '../../components/ui/index.js';
import { useDocumentTitle } from '../../hooks/useDocumentTitle.js';

// Shown for a routed page whose development phase has not been built yet. It states that
// plainly instead of showing fake data. Each phase replaces these with the real page.
export function UpcomingPage({ title, description, phase, icon: Icon = Hammer, backTo, backLabel }) {
  useDocumentTitle(title);
  return (
    <div className="mx-auto max-w-2xl py-6">
      <Card className="p-8 text-center sm:p-12">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-navy-100 text-navy-700">
          <Icon className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight text-navy-900">{title}</h1>
        <p className="mt-2 text-navy-500">{description}</p>
        <div className="mt-6">
          <Badge tone="warning">Not built yet: arrives in Phase {phase}</Badge>
        </div>
        {backTo && (
          <div className="mt-8">
            <Button to={backTo} variant="secondary">{backLabel}</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
