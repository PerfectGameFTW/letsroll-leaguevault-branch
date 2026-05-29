export function LeagueSquareCatalogEmptyLocation() {
  return (
    <div className="space-y-3 rounded-lg border p-3" data-testid="catalog-needs-location">
      <div className="text-sm font-medium">Square Catalog Items</div>
      <p className="text-sm text-muted-foreground">
        Select a location above first to load this location's Square catalog items.
      </p>
    </div>
  );
}
