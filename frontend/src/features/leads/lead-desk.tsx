"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assignFilteredLeads, assignFilteredPsLeads, assignLead, assignPsLead, autoAssignLeads, commitUpload, createLead, distributeFilteredLeads, getAdminAnalytics, getCres, getLeadDetail, getLeadsPage, getOfficers, getUpload, logCall, resolveUploadDuplicates, sourceClass, statusName, toLead, toOfficer, updateMyLead, type CallHistory, type Lead, type LeadDetail, type LeadFilters, type LeadInput, type LeadQualification, type Officer, type UploadBatch, uploadLeads } from "@/lib/crm";
import { formatDate, formatDateTime, parseDate, parseDateTime, toApiDate } from "@/lib/dates";

const statusLabels: Record<string, string> = { FRESH: "Fresh", RNR: "RNR", SWITCHED_OFF: "Switch off", CALLBACK: "Callback", PENDING: "Pending", QUALIFIED: "Qualified", UNQUALIFIED: "Unqualified", WALKIN: "Walk-in", WON: "Won", LOST: "Lost" };
const outcomeLabels: Record<string, string> = { CONNECTED: "Connected", NO_RESPONSE: "No response", CALLBACK: "Callback", QUALIFIED: "Qualified", WRONG_NUMBER: "Wrong number" };

function formatCallDate(value: string) {
  return formatDateTime(value) || value;
}

function localDateTimeValue(value: string | null) {
  return formatDateTime(value);
}

const localInputDate = (value: Date | string | null | undefined) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const addDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
};

const adminFollowUpDateToIso = (value: string) => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const [, year, month, day] = match;
  const scheduled = new Date(Number(year), Number(month) - 1, Number(day), 10, 0, 0, 0);
  const now = new Date();
  if (scheduled <= now) scheduled.setTime(now.getTime() + 5 * 60_000);
  const max = new Date(now.getTime() + 3 * 24 * 60 * 60_000 - 5 * 60_000);
  if (scheduled > max) scheduled.setTime(max.getTime());
  return scheduled.toISOString();
};

function followUpOptions() {
  const now = new Date();
  const slot = (label: string, offsetMs: number) => {
    const date = new Date(now.getTime() + offsetMs);
    return { label, value: date.toISOString() };
  };
  const atHour = (label: string, daysAhead: number, hour: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + daysAhead);
    date.setHours(hour, 0, 0, 0);
    if (date <= now) return null;
    return { label, value: date.toISOString() };
  };
  return [
    slot("In 30 minutes", 30 * 60_000),
    slot("In 1 hour", 60 * 60_000),
    slot("In 2 hours", 2 * 60 * 60_000),
    slot("In 4 hours", 4 * 60 * 60_000),
    atHour("Tomorrow 10:00 AM", 1, 10),
    atHour("Tomorrow 2:00 PM", 1, 14),
    atHour("Day after 10:00 AM", 2, 10),
  ].filter(Boolean) as { label: string; value: string }[];
}

const nextOutcomes: Record<string, { label: string; value: string }[]> = {
  Fresh: [{ label: "No response", value: "RNR" }, { label: "Schedule callback", value: "CALLBACK" }, { label: "Interested / Qualified", value: "QUALIFIED" }, { label: "Not interested", value: "UNQUALIFIED" }],
  RNR: [{ label: "Schedule callback", value: "CALLBACK" }, { label: "Interested / Qualified", value: "QUALIFIED" }, { label: "Not interested", value: "UNQUALIFIED" }],
  Callback: [{ label: "No response", value: "RNR" }, { label: "Interested / Qualified", value: "QUALIFIED" }, { label: "Book walk-in", value: "WALKIN" }, { label: "Not interested", value: "UNQUALIFIED" }],
  Qualified: [{ label: "Book walk-in", value: "WALKIN" }, { label: "Won (Sold)", value: "WON" }, { label: "Lost", value: "LOST" }],
  "Walk-in": [{ label: "Won (Sold)", value: "WON" }, { label: "Lost", value: "LOST" }],
};

const connectedOutcomes = ["Need Test Drive", "Showroom Visit", "Exchange Issue", "Booking Done", "Retail Done", "Need time", "Need SO Call", "Need More Details", "Discount Issue", "Not Interested", "Already Booked", "Lost to Competition", "Finance Rejected", "Dropped", "Lost to co-dealer"];
const notConnectedOutcomes = ["RNR", "Switch Off", "Call Me Back", "Call Forwarding", "Line Busy", "Invalid Number"];
const adminOutcomeStatus: Record<string, string> = {
  "Need Test Drive": "PENDING",
  "Showroom Visit": "PENDING",
  "Exchange Issue": "PENDING",
  "Booking Done": "WALKIN",
  "Retail Done": "WON",
  "Need time": "PENDING",
  "Need SO Call": "PENDING",
  "Need More Details": "PENDING",
  "Discount Issue": "PENDING",
  "Not Interested": "LOST",
  "Already Booked": "LOST",
  "Lost to Competition": "LOST",
  "Finance Rejected": "LOST",
  Dropped: "LOST",
  "Lost to co-dealer": "LOST",
  RNR: "RNR",
  "Switch Off": "SWITCHED_OFF",
  "Call Me Back": "CALLBACK",
  "Call Forwarding": "PENDING",
  "Line Busy": "PENDING",
  "Invalid Number": "PENDING",
};
const adminFollowUpStatuses = ["CALLBACK", "PENDING", "WALKIN"];

const resolveStatus = (outcome: string, currentStatus: string) => {
  return adminOutcomeStatus[outcome] || currentStatus;
};
const adminNeedsFollowUp = (outcome: string) => adminFollowUpStatuses.includes(resolveStatus(outcome, ""));

const sources = [["META", "Meta Ads"], ["WEBSITE", "Website"], ["CARWALE", "CarWale"], ["WALKIN", "Walk-in"], ["CAMPAIGN", "Campaign"], ["OTHER", "Other"], ["UNKNOWN", "Unknown"]];
const models = ["R6 GT", "R7 City", "R8 Lite", "R8 Pro", "R9 Plus"];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emptyLead = (): LeadInput => ({ name: "", phone: "", email: "", source: "OTHER", source_label: "", campaign: "", model_interest: "", city: "", enquiry_date: formatDate(new Date()) });
const leadSampleRows = [
  ["name", "phone", "email", "source", "campaign", "model", "city", "enquiry date"],
  ["Aarav Sharma", "9876543210", "aarav@example.com", "meta", "August Meta Leads", "R8 Pro", "Kochi", "22/08/2026"],
  ["Ananya Reddy", "9876543211", "ananya@example.com", "website", "Website Enquiry", "R7 City", "Thrissur", "22/08/2026"],
];
const downloadLeadSample = () => {
  const csv = leadSampleRows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "river-bulk-leads-sample.csv";
  link.click();
  URL.revokeObjectURL(url);
};
const leadQuery = (officerMode: boolean, followUpsOnly: boolean, filters: LeadFilters, page: number, search: string, assignmentView = "fresh") => {
  const params = new URLSearchParams();
  if (officerMode) { if (followUpsOnly) params.set("status", "CALLBACK"); }
  else { 
    if (assignmentView === "fresh") params.set("unassigned", "true");
    else if (assignmentView === "qualified") params.set("ps_unassigned", "true");
    params.set("page", String(page)); 
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, key === "date_from" || key === "date_to" ? toApiDate(value) || value : value); });
  }
  if (search) params.set("q", search);
  return `?${params.toString()}`;
};

function LeadPagination({ page, total, loading, onPageChange }: { page: number; total: number; loading: boolean; onPageChange: (page: number) => void }) {
  const pageSize = 50;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const first = total ? (page - 1) * pageSize + 1 : 0;
  const last = Math.min(page * pageSize, total);
  return <nav className="lead-pagination" aria-label="Lead pages"><span>Showing {first}–{last} of {total} leads</span><div><button className="filter" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">‹</button><b>Page {page} of {totalPages}</b><button className="filter" disabled={loading || page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Next page">›</button></div></nav>;
}

export function LeadDesk({ officerMode = false, followUpsOnly = false }: { officerMode?: boolean; followUpsOnly?: boolean }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [creUsers, setCreUsers] = useState<Officer[]>([]);
  const [psUsers, setPsUsers] = useState<Officer[]>([]);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<any>(null);
  const [assignmentView, setAssignmentView] = useState<"fresh" | "qualified" | "all">("fresh");
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [leadDetail, setLeadDetail] = useState<LeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [remarks, setRemarks] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [testDrive, setTestDrive] = useState("");
  const [callStatus, setCallStatus] = useState("Connected");
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [editDetails, setEditDetails] = useState({ name: "", phone: "", model: "", variant: "", buying_timeline: "", finance_type: "", trade_in: null as boolean | null, category: "" });
  const [savingDetails, setSavingDetails] = useState(false);
  const [savingCall, setSavingCall] = useState(false);
  const [addingLead, setAddingLead] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);
  const [newLead, setNewLead] = useState<LeadInput>(emptyLead);
  const [draggedOfficerId, setDraggedOfficerId] = useState<number | null>(null);
  const [dropTargetId, setDropTargetId] = useState<number | null>(null);
  const [upload, setUpload] = useState<UploadBatch | null>(null);
  const [uploading, setUploading] = useState(false);
  const [checkingUpload, setCheckingUpload] = useState(false);
  const [importingUpload, setImportingUpload] = useState(false);
  const [submittedLead, setSubmittedLead] = useState<string | null>(null);
  const [filters, setFilters] = useState<LeadFilters>({});
  const [activeFilters, setActiveFilters] = useState<LeadFilters>({});
  const [bulkOfficerId, setBulkOfficerId] = useState("");
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [bucketOfficerIds, setBucketOfficerIds] = useState<number[]>([]);
  const [bucketAssigning, setBucketAssigning] = useState(false);
  const [page, setPage] = useState(1);
  const [searchFilter, setSearchFilter] = useState("");
  const [totalLeads, setTotalLeads] = useState(0);
  const supportLoaded = useRef(false);
  const assignmentUsers = assignmentView === "qualified" ? psUsers : creUsers;
  const assignmentFilters = useMemo<LeadFilters>(() => ({ ...activeFilters, ...(searchFilter ? { q: searchFilter } : {}) }), [activeFilters, searchFilter]);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const queryString = leadQuery(officerMode, followUpsOnly, activeFilters, page, searchFilter, assignmentView);
      if (officerMode) { const result = await getLeadsPage(queryString); setLeads(result.results); setTotalLeads(result.count); }
      else {
        if (!supportLoaded.current) {
          const [pool, creRecords, psRecords, analyticsResult] = await Promise.all([getLeadsPage(queryString), getCres(), getOfficers(), getAdminAnalytics()]);
          setLeads(pool.results); setTotalLeads(pool.count);
          setCreUsers(creRecords.map(officer => toOfficer(officer, analyticsResult.cre.find(item => item.id === officer.id))));
          setPsUsers(psRecords.map(officer => toOfficer(officer, analyticsResult.officers.find(item => item.id === officer.id))));
          setAnalytics(analyticsResult);
          supportLoaded.current = true;
        } else {
          const pool = await getLeadsPage(queryString);
          setLeads(pool.results); setTotalLeads(pool.count);
        }
      }
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to load CRM data."); }
    finally { setLoading(false); }
  }, [activeFilters, assignmentView, followUpsOnly, officerMode, page, searchFilter]);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);
  useEffect(() => { const timer = window.setTimeout(() => { setPage(1); setSearchFilter(query.trim()); }, 250); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => { const timer = window.setTimeout(() => { setPage(1); setActiveFilters(current => JSON.stringify(current) === JSON.stringify(filters) ? current : { ...filters }); }, 250); return () => window.clearTimeout(timer); }, [filters]);
  useEffect(() => { if (assignmentView !== "fresh") setBucketOfficerIds([]); }, [assignmentView]);
  useEffect(() => {
    const open = () => setAddingLead(true);
    window.addEventListener("river:add-lead", open);
    if (!officerMode && new URLSearchParams(window.location.search).get("addLead") === "1") { open(); window.history.replaceState({}, "", "/leads"); }
    return () => window.removeEventListener("river:add-lead", open);
  }, [officerMode]);

  const visible = useMemo(() => leads.filter(lead => `${lead.name} ${lead.phone}`.toLowerCase().includes(query.toLowerCase())), [leads, query]);
  const needsAppointment = officerMode ? ["CALLBACK", "WALKIN", "PENDING"].includes(outcome) : adminNeedsFollowUp(outcome);
  const minAdminFollowUpDate = localInputDate(new Date());
  const maxAdminFollowUpDate = localInputDate(addDays(3));
  const selectedBucketOfficers = useMemo(() => bucketOfficerIds.map(id => creUsers.find(officer => officer.id === id)).filter(Boolean) as Officer[], [bucketOfficerIds, creUsers]);
  const bucketName = useMemo(() => {
    const sourceLabel = sources.find(([value]) => value === activeFilters.source)?.[1];
    const parts = [sourceLabel, activeFilters.model, activeFilters.city, activeFilters.source_label, searchFilter && `Search: ${searchFilter}`].filter(Boolean);
    return parts.length ? parts.join(" · ") : "All fresh leads";
  }, [activeFilters, searchFilter]);
  const bucketSplit = useMemo(() => {
    if (!selectedBucketOfficers.length) return [];
    const base = Math.floor(totalLeads / selectedBucketOfficers.length);
    const extra = totalLeads % selectedBucketOfficers.length;
    return selectedBucketOfficers.map((officer, index) => ({ officer, count: base + (index < extra ? 1 : 0) }));
  }, [selectedBucketOfficers, totalLeads]);

  const toggleBucketOfficer = (officerId: number) => {
    if (assignmentView !== "fresh") return;
    setBucketOfficerIds(current => current.includes(officerId) ? current.filter(id => id !== officerId) : [...current, officerId]);
  };

  const assign = async (lead: Lead, officerId: number) => {
    const previousLeads = leads;
    const previousUsers = assignmentUsers;
    const setUsers = assignmentView === "qualified" ? setPsUsers : setCreUsers;
    setLeads(current => current.filter(item => item.id !== lead.id));
    setUsers(current => current.map(officer => officer.id === officerId ? { ...officer, assigned: officer.assigned + 1 } : officer));
    try { await (assignmentView === "qualified" ? assignPsLead : assignLead)(lead.id, officerId); setNotice(`${lead.name} assigned to ${assignmentView === "qualified" ? "PS/SO" : "CRE"}.`); }
    catch (requestError) { setLeads(previousLeads); setUsers(previousUsers); setError(requestError instanceof Error ? requestError.message : "Assignment failed."); }
    finally { setDropTargetId(null); }
  };

  const autoAssign = async () => {
    try { const result = await autoAssignLeads(); setNotice(`${result.assigned} leads assigned.`); await refresh(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Auto-assignment failed."); }
  };

  const bulkAssign = async () => {
    const officer = assignmentUsers.find(item => item.id === Number(bulkOfficerId));
    if (!officer || !leads.length || bulkAssigning) return;
    if (!window.confirm(`Assign all leads matching these filters to ${officer.name}?`)) return;
    setBulkAssigning(true); setError("");
    try { const result = await (assignmentView === "qualified" ? assignFilteredPsLeads : assignFilteredLeads)(officer.id, assignmentFilters); setNotice(`${result.assigned} leads assigned to ${officer.name}.`); setBulkOfficerId(""); await refresh(); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Bulk assignment failed."); }
    finally { setBulkAssigning(false); }
  };

  const assignBucket = async () => {
    if (assignmentView !== "fresh" || !bucketOfficerIds.length || !totalLeads || bucketAssigning) return;
    if (!window.confirm(`Assign ${totalLeads} matching fresh leads across ${bucketOfficerIds.length} CREs?`)) return;
    setBucketAssigning(true); setError("");
    try {
      const result = await distributeFilteredLeads(bucketOfficerIds, assignmentFilters);
      const assignedByOfficer = new Map(result.distribution.map(item => [item.sales_officer_id, item.assigned]));
      setCreUsers(current => current.map(officer => ({ ...officer, assigned: officer.assigned + (assignedByOfficer.get(officer.id) || 0) })));
      setNotice(`${result.assigned} leads assigned across ${bucketOfficerIds.length} CREs.`);
      setBucketOfficerIds([]);
      await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Bucket assignment failed.");
    } finally {
      setBucketAssigning(false);
    }
  };

  const saveCall = async () => {
    if (!activeLead || !outcome || savingCall) return;
    if (needsAppointment && !followUpAt) { setError(officerMode ? "Select a follow-up time." : "Select a follow-up date."); return; }
    const parsedFollowUpAt = followUpAt ? officerMode ? parseDateTime(followUpAt) || (Number.isNaN(new Date(followUpAt).getTime()) ? "" : new Date(followUpAt).toISOString()) : adminFollowUpDateToIso(followUpAt) : "";
    if (needsAppointment && !parsedFollowUpAt) { setError(officerMode ? "Enter follow-up time as DD/MM/YYYY HH:mm." : "Select a valid follow-up date."); return; }
    setError("");
    setSavingCall(true);
    try {
      const normalizedFollowUpAt = parsedFollowUpAt;
      if (!officerMode && leadDetail) {
        await updateMyLead(activeLead.id, {
          status: resolveStatus(outcome, activeLead.status),
          remarks,
          call_status: callStatus,
          call_outcome: outcome,
          ...(normalizedFollowUpAt ? { follow_up_at: normalizedFollowUpAt } : {}),
          ...(testDrive ? { qualification: { variant: leadDetail.qualification?.variant || "", buying_timeline: leadDetail.qualification?.buying_timeline || "", finance_type: leadDetail.qualification?.finance_type || "", trade_in: leadDetail.qualification?.trade_in ?? null, test_drive: testDrive, notes: leadDetail.qualification?.notes || "" } } : {}),
        });
      } else {
        await logCall(activeLead.id, { status: outcome, remarks, ...(normalizedFollowUpAt ? { follow_up_at: normalizedFollowUpAt } : {}) });
      }
      setNotice(`Call log saved for ${activeLead.name}.`); setActiveLead(null); setLeadDetail(null); setRemarks(""); setFollowUpAt(""); setTestDrive(""); setCallStatus("Connected"); await refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Follow-up could not be updated.");
    } finally { setSavingCall(false); }
  };

  const startEditing = () => {
    setEditDetails({
      name: activeLead?.name || "",
      phone: activeLead?.phone || "",
      model: activeLead?.model || "",
      variant: leadDetail?.qualification?.variant || "",
      buying_timeline: leadDetail?.qualification?.buying_timeline || "",
      finance_type: leadDetail?.qualification?.finance_type || "",
      trade_in: leadDetail?.qualification?.trade_in ?? null,
      category: activeLead?.category || "WARM"
    });
    setEditingCustomer(true);
  };

  const saveCustomerDetails = async () => {
    if (!activeLead) return;
    setSavingDetails(true);
    try {
      await updateMyLead(activeLead.id, {
        name: editDetails.name,
        phone: editDetails.phone,
        model_interest: editDetails.model,
        category: editDetails.category,
        qualification: {
          variant: editDetails.variant,
          buying_timeline: editDetails.buying_timeline,
          finance_type: editDetails.finance_type,
          trade_in: editDetails.trade_in,
          test_drive: leadDetail?.qualification?.test_drive || "",
          notes: leadDetail?.qualification?.notes || ""
        }
      });
      setNotice(`Customer details updated for ${editDetails.name}.`);
      setActiveLead({ ...activeLead, name: editDetails.name, phone: editDetails.phone, model: editDetails.model, category: editDetails.category });
      if (leadDetail) {
        setLeadDetail({
          ...leadDetail,
          qualification: { ...leadDetail.qualification, variant: editDetails.variant, buying_timeline: editDetails.buying_timeline, finance_type: editDetails.finance_type, trade_in: editDetails.trade_in, test_drive: leadDetail.qualification?.test_drive || "", notes: leadDetail.qualification?.notes || "" }
        });
      }
      setEditingCustomer(false);
      const newPool = await getLeadsPage(leadQuery(officerMode, followUpsOnly, activeFilters, page, searchFilter, assignmentView));
      setLeads(newPool.results);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Details could not be saved.");
    } finally { setSavingDetails(false); }
  };

  const openLead = async (lead: Lead) => {
    const initialOutcome = officerMode ? nextOutcomes[lead.status]?.[0]?.value || "" : lead.statusCode === "WON" ? "WON" : ["LOST", "UNQUALIFIED"].includes(lead.statusCode) ? "LOST" : lead.statusCode === "PENDING" || lead.nextFollowUp ? "PENDING" : "";
    setActiveLead(lead); setOutcome(initialOutcome); setRemarks(""); setFollowUpAt(officerMode ? localDateTimeValue(lead.nextFollowUp) : localInputDate(lead.nextFollowUp)); setTestDrive(""); setCallStatus("Connected"); setEditingCustomer(false); setSavingCall(false); setError("");
    if (!officerMode) {
      setDetailLoading(true);
      try { const detail = await getLeadDetail(lead.id); setLeadDetail(detail); setFollowUpAt(localInputDate(detail.nextFollowUp)); setTestDrive(detail.qualification?.test_drive || ""); }
      catch { /* detail fetch failed, modal still works with basic data */ }
      finally { setDetailLoading(false); }
    }
  };

  const saveLead = async () => {
    if (creatingLead) return;
    const email = newLead.email?.trim() || "";
    if (email && !emailPattern.test(email)) { setError("Enter a valid email address, such as name@example.com."); return; }
    const enquiryDate = parseDate(newLead.enquiry_date || "");
    if (!enquiryDate) { setError("Enter the enquiry date as DD/MM/YYYY."); return; }
    const today = parseDate(formatDate(new Date()));
    if (today && enquiryDate > today) { setError("Enquiry date cannot be in the future."); return; }
    setCreatingLead(true); setError("");
    try {
      const lead = await createLead({ ...newLead, email, enquiry_date: enquiryDate });
      setLeads(current => [toLead(lead), ...current]);
      setAddingLead(false); setNewLead(emptyLead()); setSubmittedLead(lead.name);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Lead could not be added."); }
    finally { setCreatingLead(false); }
  };

  const selectFile = async (file?: File) => {
    if (!file) return;
    setUploading(true); setError("");
    try { const batch = await uploadLeads(file); setUpload(batch); setNotice("File received. Check import when parsing finishes."); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Upload failed."); }
    finally { setUploading(false); }
  };
  const checkUpload = async () => {
    if (!upload || checkingUpload) return;
    setCheckingUpload(true);
    try {
      const summary = await getUpload(upload.id);
      setUpload(summary.duplicates_found > 0 && summary.status === "READY" ? await getUpload(upload.id, true) : summary);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to check import."); }
    finally { setCheckingUpload(false); }
  };
  const removeDuplicates = async (rowIds: number[]) => {
    if (!upload || !rowIds.length) return;
    try {
      await resolveUploadDuplicates(upload.id, rowIds.map(id => ({ id, resolution: "SKIP" })));
      setUpload(await getUpload(upload.id, true));
      setNotice(`${rowIds.length} duplicate ${rowIds.length === 1 ? "row removed" : "rows removed"} from this import.`);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Duplicate rows could not be removed."); }
  };
  const importUpload = async () => {
    if (!upload || importingUpload) return;
    setImportingUpload(true); setError("");
    try {
      const result = await commitUpload(upload.id);
      setUpload(null); setNotice(`${result.created} leads imported. Assign them from the pool.`);
      setLoading(true);
      const pageResult = await getLeadsPage(leadQuery(false, false, activeFilters, page, searchFilter, assignmentView));
      setLeads(pageResult.results); setTotalLeads(pageResult.count);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Import failed."); }
    finally { setImportingUpload(false); setLoading(false); }
  };
  const duplicateRows = upload?.rows?.filter(row => row.duplicate_of && row.resolution === "PENDING") || [];
  const importableRows = upload?.rows ? upload.rows.filter(row => !row.validation_error && row.resolution !== "SKIP").length : upload?.parsed_ok;
  const targetLabel = assignmentView === "qualified" ? "PS/SO" : "CRE";
  const poolLabel = assignmentView === "fresh" ? "Fresh lead pool" : assignmentView === "qualified" ? "Qualified handoff pool" : "All leads";
  const heading = followUpsOnly ? "Follow-ups" : officerMode ? "My queue" : "Assignment desk";
  const adminMetrics = !officerMode && analytics?.summary ? (
    <section className="admin-leads-metrics">
      <article className="sales-metric blue">
        <span>ALL LEADS</span>
        <strong>{analytics.summary.total_assigned || 0}</strong>
        <small>Total managed leads</small>
      </article>
      <article className="sales-metric mint">
        <span>BOOKED</span>
        <strong>{analytics.summary.walkins || 0}</strong>
        <small>Appointments scheduled</small>
      </article>
      <article className="sales-metric green">
        <span>RETAILED</span>
        <strong>{analytics.summary.won || 0}</strong>
        <small>Successfully closed</small>
      </article>
      <article className="sales-metric red">
        <span>LOST</span>
        <strong>{analytics.summary.lost || 0}</strong>
        <small>Dropped leads</small>
      </article>
    </section>
  ) : null;
  const adminFilterBand = !officerMode ? (
    <section className="panel admin-filter-band">
      <section className="lead-toolbar admin-filter-toolbar">
        <label className="search"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by name or mobile..." /></label>
        <label className="button filter bulk-upload-button">{uploading ? "Uploading…" : "Bulk Upload"}<input hidden type="file" accept=".xlsx,.csv" onChange={event => void selectFile(event.target.files?.[0])} /></label>
        <button className="filter sample-download" onClick={downloadLeadSample}>Download sample format</button>
        <button className="button primary" onClick={() => { setError(""); setAddingLead(true); }}>＋ Add lead</button>
      </section>
      <section className="lead-filters admin-lead-filters">
        <div className="lead-filters-grid">
          <label>Source<select value={filters.source || ""} onChange={event => setFilters(current => ({ ...current, source: event.target.value || undefined }))}><option value="">All sources</option>{sources.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Model<input value={filters.model || ""} onChange={event => setFilters(current => ({ ...current, model: event.target.value || undefined }))} placeholder="Any model" /></label>
          <label>City<input value={filters.city || ""} onChange={event => setFilters(current => ({ ...current, city: event.target.value || undefined }))} placeholder="Any city" /></label>
          <label>Source detail<input value={filters.source_label || ""} onChange={event => setFilters(current => ({ ...current, source_label: event.target.value || undefined }))} placeholder="Google, OEM, or campaign" /></label>
          <label>From<input type="text" inputMode="numeric" pattern="\d{2}/\d{2}/\d{4}" value={filters.date_from || ""} onChange={event => setFilters(current => ({ ...current, date_from: event.target.value || undefined }))} placeholder="DD/MM/YYYY" /></label>
          <label>To<input type="text" inputMode="numeric" pattern="\d{2}/\d{2}/\d{4}" value={filters.date_to || ""} onChange={event => setFilters(current => ({ ...current, date_to: event.target.value || undefined }))} placeholder="DD/MM/YYYY" /></label>
        </div>
        <footer className="lead-filters-actions">
          <span>{Object.values(activeFilters).filter(Boolean).length || searchFilter ? `Filtered ${poolLabel.toLowerCase()}` : `All ${poolLabel.toLowerCase()}`}</span>
          <div>
            <button className="filter" onClick={() => { setFilters({}); setActiveFilters({}); setQuery(""); }}>Clear</button>
            <button className="filter" onClick={() => setActiveFilters({ ...filters })}>Apply filters</button>
            {assignmentView === "fresh" ? <section className="bucket-assignment"><p className="eyebrow">BUCKET</p><b>{bucketName}</b><span>{totalLeads} matching fresh lead{totalLeads === 1 ? "" : "s"}</span>{bucketSplit.length ? <div>{bucketSplit.map(item => <small key={item.officer.id}>{item.officer.name}: <b>{item.count}</b></small>)}</div> : <small>Select CRE cards above to split this bucket.</small>}<button className="button primary" onClick={() => void assignBucket()} disabled={!bucketOfficerIds.length || !totalLeads || bucketAssigning}>{bucketAssigning ? "Assigning…" : "Assign bucket"}</button></section> : <><select className="filter" aria-label={`Assign filtered leads to ${targetLabel}`} value={bulkOfficerId} onChange={event => setBulkOfficerId(event.target.value)}><option value="">Assign to {targetLabel}…</option>{assignmentUsers.map(officer => <option key={officer.id} value={officer.id}>{officer.name}</option>)}</select><button className="button primary" onClick={() => void bulkAssign()} disabled={!bulkOfficerId || !leads.length || bulkAssigning}>{bulkAssigning ? "Assigning…" : "Assign matching leads"}</button></>}
          </div>
        </footer>
      </section>
    </section>
  ) : null;

  return <section className="page">
    {officerMode ? <div className="page-heading compact"><div><p className="eyebrow">{heading.toUpperCase()}</p><h1>Keep the <span>promise.</span></h1><p className="subtext">Your assigned conversations and follow-ups.</p></div></div> : <div className="admin-leads-heading"><div className="admin-heading-main"><p className="eyebrow">{heading.toUpperCase()}</p><h1>All <span>leads.</span></h1><p className="subtext">Manage and assign all leads in the CRM.</p></div>{adminMetrics}<div className="admin-heading-actions">{assignmentView === "fresh" && <button className="button primary" onClick={autoAssign} disabled={!leads.length}>↻ Auto assign {leads.length} leads</button>}</div></div>}
    {!officerMode && (
      <div className="admin-lead-tabs">
        <button className={assignmentView === "fresh" ? "active" : ""} onClick={() => { setAssignmentView("fresh"); setPage(1); }}>Fresh unassigned</button>
        <button className={assignmentView === "qualified" ? "active" : ""} onClick={() => { setAssignmentView("qualified"); setPage(1); }}>Qualified unassigned</button>
        <button className={assignmentView === "all" ? "active" : ""} onClick={() => { setAssignmentView("all"); setPage(1); }}>All leads</button>
      </div>
    )}
    {adminFilterBand}
    {officerMode && <section className="lead-toolbar"><label className="search" style={{ flex: 1 }}><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by name or mobile..." /></label><button className="button primary" onClick={() => { setError(""); setAddingLead(true); }}>＋ Add lead</button></section>}
    {upload && <section className="panel" style={{ padding: "1rem", marginBottom: "1rem" }}><b>Import: {upload.status === "PARSING" ? "Checking file…" : upload.status}</b><span> · {importableRows}/{upload.total_rows} rows ready to import</span>{upload.duplicates_found > 0 && <span> · {upload.duplicates_found} duplicates need review</span>}<div style={{ display: "inline-flex", gap: ".5rem", marginLeft: "1rem" }}><button className="filter" disabled={checkingUpload || uploading} onClick={() => void checkUpload()}>{checkingUpload ? "Checking…" : "Check import"}</button>{upload.status === "READY" && !duplicateRows.length && upload.duplicates_found === 0 && <button className="button primary" disabled={importingUpload} onClick={() => void importUpload()}>{importingUpload ? "Importing…" : "Import leads"}</button>}</div>{duplicateRows.length > 0 && <div style={{ marginTop: "1rem" }}><p className="subtext">Duplicates already exist in the CRM. Remove them from this import to keep the existing lead.</p><button className="filter" onClick={() => void removeDuplicates(duplicateRows.map(row => row.id))}>Remove all duplicates</button><div style={{ display: "grid", gap: ".5rem", marginTop: ".75rem" }}>{duplicateRows.map(row => <div key={row.id} className="lead-summary"><b>Row {row.row_number} · {row.data.name || "Unnamed lead"}</b><span>Matches {row.existing_name || "existing lead"}</span><small>{row.normalized_phone} · Current status: {row.existing_status}</small><button className="row-action" onClick={() => void removeDuplicates([row.id])}>Remove duplicate</button></div>)}</div></div>}{upload.error_message && <p className="subtext">{upload.error_message}</p>}</section>}
    {error && <div className="empty-state">{error}</div>}
    {!officerMode && <aside className="officer-rail officer-grid"><header><p className="eyebrow">ACTIVE {targetLabel}</p><span>{assignmentView === "fresh" ? "Select CREs for bucket assignment, or drag one to a lead row" : `Drag a ${targetLabel} card to a lead row`}</span></header>{assignmentUsers.map(officer => <div className={`officer-card ${draggedOfficerId === officer.id ? "dragging" : ""} ${assignmentView === "fresh" && bucketOfficerIds.includes(officer.id) ? "selected" : ""}`} key={officer.id} draggable onClick={() => toggleBucketOfficer(officer.id)} onDragStart={event => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/river-officer", String(officer.id)); setDraggedOfficerId(officer.id); }} onDragEnd={() => { setDraggedOfficerId(null); setDropTargetId(null); }}><span className={`avatar ${officer.color}`}>{officer.initials}</span><span><b>{officer.name}</b><small>{targetLabel}</small></span><span className="officer-load"><small>LEAD LOAD</small><b>{officer.assigned}</b><small>CALLS TODAY</small><b>{officer.calls}</b></span></div>)}</aside>}
    <section className={officerMode ? "lead-layout one-column" : "lead-layout admin-lead-layout"}>
      <article className={officerMode ? "panel lead-pool" : "panel lead-pool admin-lead-pool"}><header className="panel-heading"><div><p className="eyebrow">{officerMode ? "ACTIVE LEADS" : poolLabel.toUpperCase()}</p><h2>{loading ? "Loading leads…" : `${leads.length} leads in pool`}</h2></div></header><div className="lead-list">{!loading && visible.length ? visible.map(lead => <div className={`lead-row ${dropTargetId === lead.id ? "drop-target" : ""}`} key={lead.id} onDragOver={event => { if (!officerMode) { event.preventDefault(); setDropTargetId(lead.id); } }} onDragLeave={() => setDropTargetId(null)} onDrop={event => { event.preventDefault(); const officerId = Number(event.dataTransfer.getData("application/river-officer")) || draggedOfficerId; if (officerId) void assign(lead, officerId); setDraggedOfficerId(null); }}>{!officerMode && <span className="drag-slot">↓</span>}<div><b>{lead.name}</b><small>{lead.phone} · #{lead.id}</small></div><span className={`badge ${sourceClass(lead.source)}`}>{lead.source}</span><span className="model">{lead.model}</span><span className={`status ${lead.status.toLowerCase().replaceAll(" ", "-")}`}>{lead.status}</span>{!officerMode && <select className="mobile-assign" aria-label={`Assign ${lead.name} to ${targetLabel}`} value="" onChange={event => { const officerId = Number(event.target.value); if (officerId) void assign(lead, officerId); }}><option value="">Assign to {targetLabel}…</option>{assignmentUsers.map(officer => <option key={officer.id} value={officer.id}>{officer.name}</option>)}</select>}<button className="row-action" onClick={() => openLead(lead)}>{officerMode ? "Log call →" : "Open →"}</button></div>) : !loading && <div className="empty-state">No leads match this view.</div>}</div></article>
    </section>
    {!officerMode && <LeadPagination page={page} total={totalLeads} loading={loading} onPageChange={setPage} />}
    {notice && <div className="toast" role="status">{notice}<button aria-label="Dismiss" onClick={() => setNotice("")}>×</button></div>}
    {addingLead && <div className="modal-layer" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="add-lead-title"><button className="modal-close" onClick={() => setAddingLead(false)} aria-label="Close">×</button><p className="eyebrow">LEAD INTAKE</p><h2 id="add-lead-title">Add a lead</h2><form className="lead-form" onSubmit={event => { event.preventDefault(); void saveLead(); }}><div className="form-grid"><label>Full name<input required maxLength={160} value={newLead.name} onChange={event => setNewLead(current => ({ ...current, name: event.target.value }))} placeholder="Customer name" /></label><label>Phone number<input required inputMode="numeric" pattern="[0-9]{10}" maxLength={10} value={newLead.phone} onChange={event => setNewLead(current => ({ ...current, phone: event.target.value.replace(/\D/g, "") }))} placeholder="10-digit mobile number" /></label><label>Email<input type="email" inputMode="email" pattern={emailPattern.source} title="Use a complete email such as name@example.com" value={newLead.email} onChange={event => setNewLead(current => ({ ...current, email: event.target.value }))} placeholder="name@example.com" /></label><label>City<input maxLength={100} value={newLead.city} onChange={event => setNewLead(current => ({ ...current, city: event.target.value }))} placeholder="City" /></label>{officerMode && <label>Lead source<select value={newLead.source} onChange={event => setNewLead(current => ({ ...current, source: event.target.value }))}>{sources.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}<label>Enquiry date<input required type="text" inputMode="numeric" pattern="\d{2}/\d{2}/\d{4}" value={newLead.enquiry_date} onChange={event => setNewLead(current => ({ ...current, enquiry_date: event.target.value }))} placeholder="DD/MM/YYYY" /></label><label>Vehicle interest<input list="vehicle-options" maxLength={100} value={newLead.model_interest} onChange={event => setNewLead(current => ({ ...current, model_interest: event.target.value }))} placeholder="Choose or type a model" /><datalist id="vehicle-options">{models.map(model => <option key={model} value={model} />)}</datalist></label><label>Campaign<input maxLength={160} value={newLead.campaign} onChange={event => setNewLead(current => ({ ...current, campaign: event.target.value }))} placeholder="Campaign name" /></label></div>{officerMode && <label style={{ marginTop: "13px", display: "block" }}>Source detail<input maxLength={100} value={newLead.source_label} onChange={event => setNewLead(current => ({ ...current, source_label: event.target.value }))} placeholder="Ad set, partner, referral, or other detail" /></label>}{error && <p className="form-error" role="alert">{error}</p>}<p className="subtext">New leads start as Fresh and appear unassigned, ready to hand to CRE.</p><footer><button type="button" className="filter" onClick={() => setAddingLead(false)}>Cancel</button><button className="button primary" disabled={creatingLead}>{creatingLead ? "Adding…" : "Add lead"}</button></footer></form></section></div>}
    {submittedLead && <div className="modal-layer" role="presentation"><section className="modal success-modal" role="dialog" aria-modal="true" aria-labelledby="submitted-title"><button className="modal-close" onClick={() => setSubmittedLead(null)} aria-label="Close">×</button><div className="success-mark" aria-hidden="true">✓</div><p className="eyebrow">LEAD SUBMITTED</p><h2 id="submitted-title">Thank you, lead submitted.</h2><p className="subtext">{submittedLead} is now in the unassigned pool, ready for CRE assignment.</p><button className="button primary" onClick={() => setSubmittedLead(null)}>Done</button></section></div>}
    {activeLead && !officerMode && <div className="modal-layer admin-follow-up-layer" role="presentation"><section className="modal sales-detail-modal admin-follow-up-modal" role="dialog" aria-modal="true" aria-labelledby="call-title" style={{ maxWidth: "44rem" }}>
      <header className="sales-detail-header"><div><p className="eyebrow">LEAD UPDATE</p><h2 id="call-title">✎ Update Follow-up</h2><p className="subtext">Update the follow-up status and details for this lead.</p></div><button className="modal-close" onClick={() => { setActiveLead(null); setLeadDetail(null); }} aria-label="Close">×</button></header>
      <div className="sales-detail-scroll">
        {error && <p className="form-error" role="alert">{error}</p>}
        <section className="sales-info-card admin-customer-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3>Customer information</h3>
            {!editingCustomer && <button type="button" className="filter" onClick={startEditing} style={{ padding: "0.25rem 0.75rem", fontSize: "0.875rem" }}>Edit details</button>}
          </div>
          {editingCustomer ? (
            <div className="form-grid" style={{ marginTop: "1rem" }}>
              <label>Customer name<input value={editDetails.name} onChange={e => setEditDetails({ ...editDetails, name: e.target.value })} maxLength={160} /></label>
              <label>Mobile<input value={editDetails.phone} onChange={e => setEditDetails({ ...editDetails, phone: e.target.value.replace(/\D/g, "") })} maxLength={10} /></label>
              <label>Model<input value={editDetails.model} onChange={e => setEditDetails({ ...editDetails, model: e.target.value })} maxLength={100} /></label>
              <label>Variant<input value={editDetails.variant} onChange={e => setEditDetails({ ...editDetails, variant: e.target.value })} maxLength={100} /></label>
              <label>Buying plan<input value={editDetails.buying_timeline} onChange={e => setEditDetails({ ...editDetails, buying_timeline: e.target.value })} maxLength={100} /></label>
              <label>Finance<input value={editDetails.finance_type} onChange={e => setEditDetails({ ...editDetails, finance_type: e.target.value })} maxLength={100} /></label>
              <label>Trade-in<select value={editDetails.trade_in === true ? "true" : editDetails.trade_in === false ? "false" : ""} onChange={e => setEditDetails({ ...editDetails, trade_in: e.target.value === "true" ? true : e.target.value === "false" ? false : null })}><option value="">—</option><option value="true">Yes</option><option value="false">No</option></select></label>
              <label>Category<select value={editDetails.category} onChange={e => setEditDetails({ ...editDetails, category: e.target.value })}><option value="HOT">Hot</option><option value="WARM">Warm</option><option value="COLD">Cold</option></select></label>
              <div style={{ gridColumn: "1 / -1", display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}><button type="button" className="filter" onClick={() => setEditingCustomer(false)}>Cancel</button><button type="button" className="button primary" disabled={savingDetails} onClick={() => void saveCustomerDetails()}>{savingDetails ? "Saving…" : "Save details"}</button></div>
            </div>
          ) : (
            <>
              <div className="sales-info-grid" style={{ marginTop: "1rem" }}>
                <span><small>Customer name</small><b>{activeLead.name}</b></span>
                <span><small>Mobile</small><b>{activeLead.phone}</b></span>
                <span><small>Model</small><b>{activeLead.model}</b></span>
                <span><small>Variant</small><b>{leadDetail?.qualification?.variant || "—"}</b></span>
                <span><small>Buying plan</small><b>{leadDetail?.qualification?.buying_timeline || "—"}</b></span>
                <span><small>Finance</small><b>{leadDetail?.qualification?.finance_type || "—"}</b></span>
              </div>
              <div className="sales-detail-meta"><span>Trade-in <b>{leadDetail?.qualification?.trade_in === true ? "Yes" : leadDetail?.qualification?.trade_in === false ? "No" : "—"}</b></span><span>Category <b className={`category-pill ${activeLead.category?.toLowerCase() || "warm"}`}>{activeLead.category || "WARM"}</b></span></div>
            </>
          )}

        </section>
        {(detailLoading || leadDetail?.callHistory.length) ? <section className="sales-form-card admin-call-history">
          <h3>Call history</h3>
          {detailLoading ? <p className="subtext">Loading call history…</p> : <div className="admin-history-list">{leadDetail?.callHistory.map((call, index) => <div className="sales-history-row" key={`call-${call.id}`}><div><b>Call #{leadDetail.callHistory.length - index} · {call.so_name || "Admin"}</b><small>{call.remarks || "No remarks"}</small><div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap", marginTop: "0.25rem" }}>{call.call_status && <span className="admin-history-outcome" style={{ background: "#e2e8f0", color: "#1e293b" }}>{call.call_status}</span>}{call.outcome && <span className="admin-history-outcome">{call.outcome}</span>}</div></div><time>{formatCallDate(call.created_at)}</time></div>)}</div>}
        </section> : null}
        <section className="sales-form-card admin-call-card">
          <h3>Log follow-up F{leadDetail ? leadDetail.callHistory.length + 1 : 1}</h3>
          <div className="admin-follow-up-grid">
            <div style={{ gridColumn: "1 / -1" }}><h4>Call status *</h4><div className="sales-choice-row admin-outcome-row" style={{ display: "flex", gap: "0.5rem" }}><button type="button" className={callStatus === "Connected" ? "chosen" : ""} onClick={() => { setCallStatus("Connected"); setOutcome(""); }}>Connected</button><button type="button" className={callStatus === "Not Connected" ? "chosen" : ""} onClick={() => { setCallStatus("Not Connected"); setOutcome(""); }}>Not Connected</button></div></div>
            <div style={{ gridColumn: "1 / -1" }}><h4>Outcome *</h4><div className="sales-choice-row admin-outcome-row" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>{(callStatus === "Connected" ? connectedOutcomes : notConnectedOutcomes).map(item => <button type="button" className={outcome === item ? "chosen" : ""} onClick={() => { setOutcome(item); if (!adminNeedsFollowUp(item)) setFollowUpAt(""); }} key={item}>{item}</button>)}</div></div>

            <label className="sales-full-label" style={{ gridColumn: "1 / -1" }}>Remarks<textarea maxLength={500} value={remarks} onChange={event => setRemarks(event.target.value)} placeholder="Enter your call remarks…" /></label>
            {needsAppointment && <label className="admin-follow-up-date"><span><b>Next follow-up date</b> *</span><input type="date" required min={minAdminFollowUpDate} max={maxAdminFollowUpDate} value={followUpAt} onChange={event => setFollowUpAt(event.target.value)} /></label>}
            <div><h4>Test drive</h4><label className="admin-checkbox-card"><input type="checkbox" checked={testDrive === "Completed"} onChange={event => setTestDrive(event.target.checked ? "Completed" : "")} /> <span>Mark test drive as done</span></label></div>
          </div>
        </section>
      </div>
      <footer className="sales-detail-footer"><button className="filter" onClick={() => { setActiveLead(null); setLeadDetail(null); }}>Cancel</button><button className="button primary" disabled={savingCall || (needsAppointment && !followUpAt) || !outcome} onClick={() => void saveCall()}>{savingCall ? "Saving…" : "Update Follow-up"}</button></footer>
    </section></div>}
    {activeLead && officerMode && <div className="modal-layer" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="call-title-so"><button className="modal-close" onClick={() => setActiveLead(null)} aria-label="Close">×</button><p className="eyebrow">CALL LOG</p><h2 id="call-title-so">Update {activeLead.name}</h2><div className="lead-summary"><b>#{activeLead.id} · {activeLead.model}</b><span>{activeLead.source} lead</span><small>{activeLead.phone} · {activeLead.city || "—"}</small></div>{nextOutcomes[activeLead.status]?.length ? <><div className="form-grid"><label>Next outcome<select value={outcome} onChange={event => { setOutcome(event.target.value); if (!["CALLBACK", "WALKIN"].includes(event.target.value)) setFollowUpAt(""); }}>{nextOutcomes[activeLead.status].map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{needsAppointment && <label>{outcome === "WALKIN" ? "Walk-in appointment" : "Follow-up time"}<select required value={followUpAt} onChange={event => setFollowUpAt(event.target.value)}><option value="">Select time</option>{followUpOptions().map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select></label>}</div><label>Remarks<textarea maxLength={500} value={remarks} onChange={event => setRemarks(event.target.value)} placeholder="Add a clear note from the conversation" /></label><footer><button className="filter" onClick={() => setActiveLead(null)}>Cancel</button><button className="button primary" disabled={savingCall || (needsAppointment && !followUpAt) || !outcome} onClick={() => void saveCall()}>{savingCall ? "Saving…" : "Save call log"}</button></footer></> : <p className="subtext">This lead is closed. Reopen it before recording another outcome.</p>}</section></div>}
  </section>;
}
