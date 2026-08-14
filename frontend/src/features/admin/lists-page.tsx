"use client";

import { useEffect, useState, FormEvent } from "react";
import { getSystemConfig, updateSystemConfig, type SystemConfig } from "@/lib/crm";

export function ListsPage() {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSystemConfig()
      .then(res => setConfig(res))
      .catch(err => setError(err instanceof Error ? err.message : "Failed to load lists."))
      .finally(() => setLoading(false));
  }, []);

  const handleAdd = async (listName: keyof SystemConfig["lists"], value: string) => {
    if (!value.trim() || !config) return;
    const currentList = config.lists[listName] || [];
    if (currentList.includes(value.trim())) return; // Duplicate
    
    const newLists = { ...config.lists, [listName]: [...currentList, value.trim()] };
    try {
      const updated = await updateSystemConfig(newLists);
      setConfig(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update list.");
    }
  };

  const handleRemove = async (listName: keyof SystemConfig["lists"], value: string) => {
    if (!config) return;
    const currentList = config.lists[listName] || [];
    const newLists = { ...config.lists, [listName]: currentList.filter(item => item !== value) };
    try {
      const updated = await updateSystemConfig(newLists);
      setConfig(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update list.");
    }
  };

  const ListSection = ({ title, name }: { title: string, name: keyof SystemConfig["lists"] }) => {
    const items = config?.lists?.[name] || [];
    return (
      <article className="panel" style={{ marginBottom: "1.5rem" }}>
        <header className="panel-heading">
          <h2>{title} ({items.length})</h2>
        </header>
        <form 
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem("itemValue") as HTMLInputElement;
            handleAdd(name, input.value);
            input.value = "";
          }}
          style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}
        >
          <input name="itemValue" required className="input-field" placeholder={`Add ${title.toLowerCase().slice(0, -1)}`} style={{ flex: 1 }} />
          <button type="submit" className="button primary">Add</button>
        </form>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {items.map(item => (
            <li key={item} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid var(--border)" }}>
              <span>{item}</span>
              <button type="button" className="button" style={{ fontSize: "0.8rem" }} onClick={() => handleRemove(name, item)}>Remove</button>
            </li>
          ))}
        </ul>
      </article>
    );
  };

  if (loading) return <div className="page" style={{ textAlign: "center", padding: "4rem" }}>Loading...</div>;

  return (
    <section className="page" style={{ maxWidth: "600px", margin: "0 auto", paddingBottom: "4rem" }}>
      <div className="page-heading compact">
        <div>
          <h1>Lists <span>Administrator</span></h1>
        </div>
      </div>
      
      {error && <div className="empty-state">{error}</div>}

      <ListSection title="Branches" name="branches" />
      <ListSection title="Sources" name="sources" />
      <ListSection title="Activities" name="activities" />
      <ListSection title="Model names" name="models" />
    </section>
  );
}
