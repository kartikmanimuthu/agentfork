export default function DashboardNotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center p-6">
      <h2 className="text-2xl font-bold">Page not found</h2>
      <p className="text-muted-foreground">
        This dashboard page does not exist.
      </p>
    </div>
  );
}
