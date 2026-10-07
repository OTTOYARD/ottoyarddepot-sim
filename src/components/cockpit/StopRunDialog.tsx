import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * Stop from the run transport (RunTransport: the phone's run bar and the desktop top
 * bar) asks first: the run stops for everyone watching it. `onStop` is useStopRun's stop.
 */
export function StopRunDialog({ open, onOpenChange, onStop }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStop: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-canvas-panel border-white/10 text-ink max-w-sm" data-testid="stop-run-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Stop this run?</AlertDialogTitle>
          <AlertDialogDescription className="text-ink-dim">
            The run stops for all viewers. The depot becomes empty. Its Black Box stays on the Runs tab.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="bg-canvas-elev border-white/10 text-ink">Continue run</AlertDialogCancel>
          <AlertDialogAction className="bg-brand-red hover:bg-brand-deep text-white" onClick={onStop}>Stop run</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
