import { FormControl, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import type { InsertLeague } from "@shared/schema";

interface CatalogItemVariation {
  id: string;
  name: string;
  price: number | null;
  currency: string;
}

interface CatalogItem {
  id: string;
  name: string;
  description: string;
  variations: CatalogItemVariation[];
}

interface CatalogCategory {
  id: string;
  name: string;
}

interface LeagueSquareCatalogProps {
  form: UseFormReturn<InsertLeague>;
  locationId: number | null;
  selectedCategoryId: string | null;
  onCategoryChange: (categoryId: string | null) => void;
}

export function LeagueSquareCatalog({
  form,
  locationId,
  selectedCategoryId,
  onCategoryChange,
}: LeagueSquareCatalogProps) {
  const catalogLocationParam = locationId ? `?locationId=${locationId}` : '';

  const { data: categoriesData } = useQuery<{ success: boolean; data: CatalogCategory[] }>({
    queryKey: ['/api/payments-provider/catalog/categories', locationId],
    queryFn: async () => {
      const res = await fetch(`/api/payments-provider/catalog/categories${catalogLocationParam}`);
      if (!res.ok) throw new Error('Failed to fetch catalog categories');
      return res.json();
    },
    staleTime: 1000 * 60 * 10,
    enabled: !!locationId,
  });
  const categories = categoriesData?.data || [];

  const { data: allCatalogData, isLoading: isLoadingCatalog } = useQuery<{ success: boolean; data: CatalogItem[] }>({
    queryKey: ['/api/payments-provider/catalog/items', locationId],
    queryFn: async () => {
      const res = await fetch(`/api/payments-provider/catalog/items${catalogLocationParam}`);
      if (!res.ok) throw new Error('Failed to fetch catalog items');
      return res.json();
    },
    staleTime: 1000 * 60 * 10,
    enabled: !!locationId,
  });
  const allCatalogItems = allCatalogData?.data || [];

  const { data: filteredCatalogData } = useQuery<{ success: boolean; data: CatalogItem[] }>({
    queryKey: ['/api/payments-provider/catalog/items', locationId, selectedCategoryId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedCategoryId) params.set('categoryId', selectedCategoryId);
      if (locationId) params.set('locationId', String(locationId));
      const res = await fetch(`/api/payments-provider/catalog/items?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch catalog items');
      return res.json();
    },
    staleTime: 1000 * 60 * 10,
    enabled: !!selectedCategoryId && !!locationId,
  });

  const catalogItems = selectedCategoryId ? (filteredCatalogData?.data || []) : allCatalogItems;
  const hasCatalogItems = allCatalogItems.length > 0;

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchInput.trim().toLowerCase()), 200);
    return () => clearTimeout(id);
  }, [searchInput]);

  const visibleCatalogItems = useMemo(() => {
    if (!debouncedSearch) return catalogItems;
    return catalogItems.filter(item => item.name.toLowerCase().includes(debouncedSearch));
  }, [catalogItems, debouncedSearch]);
  const isSearching = debouncedSearch.length > 0;

  const getPriceForVariation = (variationId: string | null | undefined): number | null => {
    if (!variationId) return null;
    const searchLists = [allCatalogItems, catalogItems];
    for (const list of searchLists) {
      for (const item of list) {
        const v = item.variations.find(v => v.id === variationId);
        if (v) return v.price;
      }
    }
    return null;
  };

  if (!locationId) {
    return (
      <div className="space-y-3 rounded-lg border p-3" data-testid="catalog-needs-location">
        <div className="text-sm font-medium">Square Catalog Items</div>
        <p className="text-sm text-muted-foreground">
          Select a location above first to load this location's Square catalog items.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="text-sm font-medium">Square Catalog Items</div>

      {isLoadingCatalog && (
        <p className="text-sm text-muted-foreground">Loading catalog items&hellip;</p>
      )}

      {!isLoadingCatalog && !hasCatalogItems && (
        <p className="text-sm text-muted-foreground">No Square catalog items found for this location. Make sure Square credentials are configured in the integrations settings.</p>
      )}

      <FormItem>
        <FormLabel>Search Items</FormLabel>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            placeholder="Search by item name…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            disabled={!hasCatalogItems}
            className="pl-8 pr-8"
            data-testid="input-catalog-search"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
              data-testid="button-clear-catalog-search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {isSearching && (
          <p className="text-xs text-muted-foreground" data-testid="text-catalog-search-count">
            {visibleCatalogItems.length === 0
              ? 'No items match your search'
              : `${visibleCatalogItems.length} of ${catalogItems.length} item${catalogItems.length === 1 ? '' : 's'} match`}
          </p>
        )}
      </FormItem>

      <FormItem>
        <FormLabel>Filter by Category</FormLabel>
        <Select
          value={
            !hasCatalogItems
              ? undefined
              : (selectedCategoryId || 'all')
          }
          onValueChange={(value) => {
            const catId = value === 'all' ? null : value;
            onCategoryChange(catId);
            form.setValue('squareCategoryId', catId);
          }}
          disabled={!hasCatalogItems}
        >
          <FormControl>
            <SelectTrigger>
              <SelectValue placeholder={!hasCatalogItems ? "No Square items configured for this location" : "All Categories"} />
            </SelectTrigger>
          </FormControl>
          <SelectContent>
            {!hasCatalogItems && (
              <SelectItem value="__no-items" disabled>No Square items configured for this location</SelectItem>
            )}
            {hasCatalogItems && (
              <>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                ))}
              </>
            )}
          </SelectContent>
        </Select>
      </FormItem>

      <FormItem>
        <FormLabel>Lineage Item</FormLabel>
        <Select
          value={
            !hasCatalogItems
              ? undefined
              : (form.watch('lineageItemVariationId') || 'none')
          }
          onValueChange={(value) => {
            if (value === 'none') {
              form.setValue('squareLineageItemId', null);
              form.setValue('lineageItemVariationId', null);
              form.setValue('squareLineageItemName', null);
              form.setValue('lineageFee', null);
            } else {
              for (const item of catalogItems) {
                const variation = item.variations.find(v => v.id === value);
                if (variation) {
                  form.setValue('squareLineageItemId', item.id);
                  form.setValue('lineageItemVariationId', variation.id);
                  form.setValue('squareLineageItemName', `${item.name}${variation.name !== 'Regular' && variation.name !== 'Default' ? ` - ${variation.name}` : ''}`);
                  const lineagePrice = variation.price || 0;
                  const prizeFundPrice = getPriceForVariation(form.getValues('prizeFundItemVariationId'));
                  const total = lineagePrice + (prizeFundPrice || 0);
                  if (total > 0) form.setValue('weeklyFee', total);
                  if (lineagePrice > 0) form.setValue('lineageFee', lineagePrice);
                  break;
                }
              }
            }
          }}
          disabled={!hasCatalogItems}
        >
          <FormControl>
            <SelectTrigger>
              <SelectValue placeholder={!hasCatalogItems ? "No Square items configured for this location" : "None"} />
            </SelectTrigger>
          </FormControl>
          <SelectContent>
            {!hasCatalogItems && (
              <SelectItem value="__no-items" disabled>No Square items configured for this location</SelectItem>
            )}
            {hasCatalogItems && (
              <>
                <SelectItem value="none">None</SelectItem>
                {(() => {
                  const savedId = form.watch('lineageItemVariationId');
                  const savedName = form.watch('squareLineageItemName');
                  const isInList = savedId && visibleCatalogItems.some(item => item.variations.some(v => v.id === savedId));
                  if (savedId && savedName && !isInList) {
                    return <SelectItem key={savedId} value={savedId}>{savedName}</SelectItem>;
                  }
                  return null;
                })()}
                {visibleCatalogItems.map((item) =>
                  item.variations.map((variation) => (
                    <SelectItem key={variation.id} value={variation.id}>
                      {item.name}{variation.name !== 'Regular' && variation.name !== 'Default' ? ` - ${variation.name}` : ''}
                      {variation.price !== null ? ` ($${(variation.price / 100).toFixed(2)})` : ''}
                    </SelectItem>
                  ))
                )}
              </>
            )}
          </SelectContent>
        </Select>
      </FormItem>

      <FormItem>
        <FormLabel>Prize Fund Item</FormLabel>
        <Select
          value={
            !hasCatalogItems
              ? undefined
              : (form.watch('prizeFundItemVariationId') || 'none')
          }
          onValueChange={(value) => {
            if (value === 'none') {
              form.setValue('squarePrizeFundItemId', null);
              form.setValue('prizeFundItemVariationId', null);
              form.setValue('squarePrizeFundItemName', null);
              form.setValue('prizeFundFee', null);
            } else {
              for (const item of catalogItems) {
                const variation = item.variations.find(v => v.id === value);
                if (variation) {
                  form.setValue('squarePrizeFundItemId', item.id);
                  form.setValue('prizeFundItemVariationId', variation.id);
                  form.setValue('squarePrizeFundItemName', `${item.name}${variation.name !== 'Regular' && variation.name !== 'Default' ? ` - ${variation.name}` : ''}`);
                  const lineagePrice = getPriceForVariation(form.getValues('lineageItemVariationId'));
                  const prizeFundPrice = variation.price || 0;
                  const total = (lineagePrice || 0) + prizeFundPrice;
                  if (total > 0) form.setValue('weeklyFee', total);
                  if (prizeFundPrice > 0) form.setValue('prizeFundFee', prizeFundPrice);
                  break;
                }
              }
            }
          }}
          disabled={!hasCatalogItems}
        >
          <FormControl>
            <SelectTrigger>
              <SelectValue placeholder={!hasCatalogItems ? "No Square items configured for this location" : "None"} />
            </SelectTrigger>
          </FormControl>
          <SelectContent>
            {!hasCatalogItems && (
              <SelectItem value="__no-items" disabled>No Square items configured for this location</SelectItem>
            )}
            {hasCatalogItems && (
              <>
                <SelectItem value="none">None</SelectItem>
                {(() => {
                  const savedId = form.watch('prizeFundItemVariationId');
                  const savedName = form.watch('squarePrizeFundItemName');
                  const isInList = savedId && visibleCatalogItems.some(item => item.variations.some(v => v.id === savedId));
                  if (savedId && savedName && !isInList) {
                    return <SelectItem key={savedId} value={savedId}>{savedName}</SelectItem>;
                  }
                  return null;
                })()}
                {visibleCatalogItems.map((item) =>
                  item.variations.map((variation) => (
                    <SelectItem key={variation.id} value={variation.id}>
                      {item.name}{variation.name !== 'Regular' && variation.name !== 'Default' ? ` - ${variation.name}` : ''}
                      {variation.price !== null ? ` ($${(variation.price / 100).toFixed(2)})` : ''}
                    </SelectItem>
                  ))
                )}
              </>
            )}
          </SelectContent>
        </Select>
      </FormItem>
    </div>
  );
}
