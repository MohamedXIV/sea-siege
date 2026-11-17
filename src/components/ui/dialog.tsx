import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// Official shadcn/ui Dialog structure, adapted to this app's Tailwind tokens.
function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}
function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}
function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}
function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}
function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return <DialogPrimitive.Overlay data-slot="dialog-overlay"
    className={cn("fixed inset-0 z-50 bg-black/60", className)} {...props} />;
}
function DialogContent({ className, children, showCloseButton = true, ...props }:
  React.ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
  return <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content data-slot="dialog-content"
      className={cn("fixed left-1/2 top-1/2 z-50 grid max-h-[min(92svh,42rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border border-border bg-background p-5 text-foreground shadow-xl outline-none sm:p-6", className)}
      {...props}>
      {children}
      {showCloseButton && <DialogPrimitive.Close data-slot="dialog-close"
        className="absolute right-3 top-3 rounded-sm p-2 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Close dialog">
        <XIcon className="size-4" aria-hidden="true" />
      </DialogPrimitive.Close>}
    </DialogPrimitive.Content>
  </DialogPortal>;
}
function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-2 text-left", className)} {...props} />;
}
function DialogFooter({ className, showCloseButton = false, children, ...props }:
  React.ComponentProps<"div"> & { showCloseButton?: boolean }) {
  return <div data-slot="dialog-footer"
    className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props}>
    {children}
    {showCloseButton && <DialogPrimitive.Close asChild><Button variant="outline">Close</Button></DialogPrimitive.Close>}
  </div>;
}
function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn("text-lg font-semibold", className)} {...props} />;
}
function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description"
    className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
export { Dialog, DialogTrigger, DialogPortal, DialogClose, DialogOverlay,
  DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
