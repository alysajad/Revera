"use client";

import { useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createLead, getSystemConfig, getOfficers, type Officer, type SystemConfig } from "@/lib/crm";
import { formatDate } from "@/lib/dates";

export default function CaptureLeadPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [officers, setOfficers] = useState<Officer[]>([]);

  const [sourceType, setSourceType] = useState<"Walk-in" | "Digital">("Walk-in");
  const [digitalSource, setDigitalSource] = useState("WEBSITE");

  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    enquiry_date: "",
    profession: "",
    model_interest: "",
    variant: "",
    buying_timeline: "",
    assigned_ps_id: "",
  });

  useEffect(() => {
    getSystemConfig().then(setConfig).catch(console.error);
    getOfficers().then(setOfficers).catch(console.error);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleClear = () => {
    setFormData({
      name: "", phone: "", enquiry_date: "", profession: "",
      model_interest: "", variant: "", buying_timeline: "", assigned_ps_id: ""
    });
    setSourceType("Walk-in");
    setError("");
    setSuccess(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess(false);

    try {
      const payload = {
        name: formData.name,
        phone: formData.phone,
        enquiry_date: formData.enquiry_date || undefined,
        profession: formData.profession,
        source: sourceType === "Walk-in" ? "WALKIN" : digitalSource,
        model_interest: formData.model_interest,
        assigned_ps_id: formData.assigned_ps_id ? parseInt(formData.assigned_ps_id) : undefined,
        qualification_input: {
          variant: formData.variant,
          buying_timeline: formData.buying_timeline,
          finance_type: "",
          test_drive: "",
          notes: ""
        }
      };
      
      // Force initial status to WALKIN for walk-ins, otherwise FRESH. (This is handled by backend default FRESH, but we can pass status=WALKIN)
      // Actually backend defaults to FRESH if not provided. Let's pass status.
      const finalPayload = {
        ...payload,
        status: sourceType === "Walk-in" ? "WALKIN" : "FRESH"
      };

      // Since createLead type in crm.ts doesn't explicitly list `status` in LeadInput but it accepts it if we cheat or update LeadInput.
      // Wait, let's just pass it in.
      await createLead(finalPayload as any);
      setSuccess(true);
      setTimeout(() => {
        handleClear();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to capture lead.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page" style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
      <div className="page-heading">
        <div>
          <h1>Capture New Lead</h1>
        </div>
      </div>
      
      <form className="panel" style={{ padding: "2rem" }} onSubmit={submit}>
        {error && <div className="badge red" style={{ marginBottom: "1rem", display: "block", padding: "0.5rem" }}>{error}</div>}
        {success && <div className="badge green" style={{ marginBottom: "1rem", display: "block", padding: "0.5rem" }}>Lead successfully captured!</div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "1.5rem" }}>
          <label>
            Customer Name *
            <input type="text" name="name" value={formData.name} onChange={handleChange} required placeholder="Enter customer name" />
          </label>
          <label>
            Mobile Number *
            <input type="tel" name="phone" value={formData.phone} onChange={handleChange} required pattern="\d{10}" placeholder="10-digit mobile number" />
          </label>
        </div>

        <div style={{ marginBottom: "1.5rem" }}>
          <label>
            Lead Creation Date & Time (Optional)
            <input type="date" name="enquiry_date" value={formData.enquiry_date} onChange={handleChange} />
            <small style={{ display: "block", color: "var(--text-secondary)", marginTop: "0.25rem" }}>Leave empty to use current date and time</small>
          </label>
        </div>

        <div style={{ marginBottom: "1.5rem" }}>
          <label>
            Profession
            <input type="text" name="profession" value={formData.profession} onChange={handleChange} placeholder="Enter profession (optional)" />
          </label>
        </div>

        <div style={{ marginBottom: "1.5rem" }}>
          <label style={{ display: "block", marginBottom: "0.5rem" }}>Source *</label>
          <div style={{ display: "flex", gap: "1rem" }}>
            <label style={{ flex: 1, padding: "1rem", border: `1px solid ${sourceType === "Walk-in" ? "var(--orange-500)" : "var(--border-color)"}`, borderRadius: "var(--radius)", background: sourceType === "Walk-in" ? "var(--orange-50)" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input type="radio" checked={sourceType === "Walk-in"} onChange={() => setSourceType("Walk-in")} style={{ margin: 0 }} />
              Walk-in
            </label>
            <label style={{ flex: 1, padding: "1rem", border: `1px solid ${sourceType === "Digital" ? "var(--orange-500)" : "var(--border-color)"}`, borderRadius: "var(--radius)", background: sourceType === "Digital" ? "var(--orange-50)" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <input type="radio" checked={sourceType === "Digital"} onChange={() => setSourceType("Digital")} style={{ margin: 0 }} />
              Digital
            </label>
          </div>
          {sourceType === "Digital" && (
            <div style={{ marginTop: "1rem" }}>
              <select value={digitalSource} onChange={e => setDigitalSource(e.target.value)} required>
                {config?.lists?.sources?.filter(s => s !== "WALKIN").map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", marginBottom: "1.5rem" }}>
          <label>
            Model Interested *
            <select name="model_interest" value={formData.model_interest} onChange={handleChange} required>
              <option value="">Select model</option>
              {config?.lists?.models?.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            Variant *
            <input type="text" name="variant" value={formData.variant} onChange={handleChange} required placeholder="Select variant" />
          </label>
        </div>

        <div style={{ marginBottom: "1.5rem" }}>
          <label>
            Purchase Timeline *
            <select name="buying_timeline" value={formData.buying_timeline} onChange={handleChange} required>
              <option value="">Select timeline</option>
              <option value="Immediate">Immediate (0-15 days)</option>
              <option value="Short Term">Short Term (1-2 months)</option>
              <option value="Long Term">Long Term (2+ months)</option>
            </select>
          </label>
        </div>

        <div style={{ marginBottom: "2rem" }}>
          <label>
            Assign to PS *
            <select name="assigned_ps_id" value={formData.assigned_ps_id} onChange={handleChange} required>
              <option value="">Select PS</option>
              {officers.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "1rem" }}>
          <button type="button" className="button" onClick={handleClear} disabled={loading}>Clear</button>
          <button type="submit" className="button primary" disabled={loading} style={{ background: "var(--green-500)", borderColor: "var(--green-500)", color: "white" }}>
            {loading ? "Submitting..." : "Submit Lead"}
          </button>
        </div>
      </form>
    </div>
  );
}
