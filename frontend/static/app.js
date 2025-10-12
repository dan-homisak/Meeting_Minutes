const { useEffect, useMemo, useState } = React;
const rootEl = document.getElementById("root");

const api = {
  async list() {
    const res = await fetch("/api/items");
    if (!res.ok) throw new Error("Unable to load items");
    return res.json();
  },
  async create(payload) {
    const res = await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Unable to create item");
    return res.json();
  },
  async update(id, payload) {
    const res = await fetch(`/api/items/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Unable to update item");
    return res.json();
  },
  async remove(id) {
    const res = await fetch(`/api/items/${id}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 204) throw new Error("Unable to delete item");
  },
};

function useItems() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = async () => {
    try {
      setLoading(true);
      const data = await api.list();
      setItems(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  return useMemo(
    () => ({
      items,
      loading,
      error,
      setItems,
      refresh,
    }),
    [items, loading, error]
  );
}

function App() {
  const { items, loading, error, setItems, refresh } = useItems();
  const [form, setForm] = useState({ title: "", description: "" });
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const notifyShutdown = () => {
      try {
        navigator.sendBeacon("/api/shutdown", "");
      } catch (err) {
        fetch("/api/shutdown", { method: "POST", keepalive: true }).catch(() => {});
      }
    };

    window.addEventListener("beforeunload", notifyShutdown);
    window.addEventListener("pagehide", notifyShutdown);

    return () => {
      window.removeEventListener("beforeunload", notifyShutdown);
      window.removeEventListener("pagehide", notifyShutdown);
    };
  }, []);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setForm({ title: "", description: "" });
    setEditing(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) {
      alert("Title is required");
      return;
    }

    setBusy(true);
    try {
      if (editing) {
        const updated = await api.update(editing.id, form);
        setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        const created = await api.create(form);
        setItems((prev) => [created, ...prev]);
      }
      resetForm();
    } catch (err) {
      alert(err.message || "Unexpected error");
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = (item) => {
    setEditing(item);
    setForm({ title: item.title, description: item.description || "" });
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete "${item.title}"?`)) {
      return;
    }
    setBusy(true);
    try {
      await api.remove(item.id);
      setItems((prev) => prev.filter((current) => current.id !== item.id));
    } catch (err) {
      alert(err.message || "Unable to delete item");
    } finally {
      setBusy(false);
    }
  };

  const handleCancelEdit = () => resetForm();

  return React.createElement(
    "div",
    { className: "app" },
    React.createElement("h1", null, "Project Skeleton Demo"),
    React.createElement(
      "form",
      { onSubmit: handleSubmit },
      React.createElement("input", {
        name: "title",
        placeholder: "Item title",
        value: form.title,
        onChange: handleChange,
        disabled: busy,
        maxLength: 200,
      }),
      React.createElement("textarea", {
        name: "description",
        placeholder: "Add a description (optional)",
        value: form.description,
        onChange: handleChange,
        disabled: busy,
        maxLength: 5000,
      }),
      React.createElement(
        "div",
        { className: "actions" },
        React.createElement(
          "button",
          { className: "primary", type: "submit", disabled: busy },
          editing ? "Save changes" : "Add item"
        ),
        editing &&
          React.createElement(
            "button",
            { className: "secondary", type: "button", onClick: handleCancelEdit, disabled: busy },
            "Cancel edit"
          )
      )
    ),
    loading
      ? React.createElement("p", null, "Loading items…")
      : error
      ? React.createElement("p", { style: { color: "#dc2626" } }, error)
      : items.length === 0
      ? React.createElement(
          "div",
          { className: "empty-state" },
          "Your list is empty. Add the first item above."
        )
      : React.createElement(
          "div",
          { className: "items" },
          items.map((item) =>
            React.createElement(
              "article",
              { className: "item-card", key: item.id },
              React.createElement("h2", null, item.title),
              item.description
                ? React.createElement("p", null, item.description)
                : React.createElement("p", { style: { fontStyle: "italic", color: "#94a3b8" } }, "No description"),
              React.createElement(
                "div",
                { className: "actions" },
                React.createElement(
                  "button",
                  { className: "secondary", type: "button", onClick: () => handleEdit(item), disabled: busy },
                  "Edit"
                ),
                React.createElement(
                  "button",
                  {
                    className: "secondary",
                    type: "button",
                    onClick: () => handleDelete(item),
                    disabled: busy,
                  },
                  "Delete"
                )
              )
            )
          )
        )
  );
}

ReactDOM.createRoot(rootEl).render(React.createElement(App));
