import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListClientDocuments,
  useRequestUploadUrl,
  useDiscardUpload,
  useExtractDocument,
  useCreateClientDocument,
  type ClientDetail,
  type DocumentType
} from '@workspace/api-client-react';
import { useAuth } from '@workspace/replit-auth-web';
import { format } from 'date-fns';
import { SectionHeading, EmptyState, QueryError, SkeletonRows } from '@/components/MarqueUI';
import { LoaderCircle, UploadCloud, Check, X } from 'lucide-react';
import { useLocation } from 'wouter';

export function ClientDocumentsTab({ client }: { client: ClientDetail }) {
  const { isAuthenticated, isLoading, login } = useAuth();

  if (isLoading) {
    return (
      <div className="p-7">
        <SkeletonRows count={3} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="rounded-sm border border-border bg-card p-5 sm:p-7 flex flex-col items-center justify-center text-center">
        <h3 className="font-serif text-xl mb-2">Authentication Required</h3>
        <p className="text-sm text-muted-foreground mb-4">You must be logged in to view and manage client documents.</p>
        <button
          type="button"
          onClick={login}
          className="inline-flex items-center justify-center rounded-sm bg-primary px-4 py-2 text-xs font-bold uppercase tracking-[.13em] text-primary-foreground transition hover:bg-primary/90"
        >
          Login
        </button>
      </div>
    );
  }

  return <ClientDocumentsContent client={client} />;
}

function ClientDocumentsContent({ client }: { client: ClientDetail }) {
  const queryClient = useQueryClient();
  const [location] = useLocation();
  
  const listDocsQuery = useListClientDocuments(client.id);
  const requestUploadUrl = useRequestUploadUrl();
  const discardUpload = useDiscardUpload();
  const extractDocument = useExtractDocument();
  const createDocument = useCreateClientDocument();

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingObjectPath, setPendingObjectPath] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'extracting' | 'extracted' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  
  const [draftDoc, setDraftDoc] = useState<{
    documentType: DocumentType;
    date: string;
    amountAed: number;
    vendorName: string;
    description: string;
    warrantyExpiry: string | null;
    vehicleId: number | null;
    objectPath: string;
    originalFileName: string;
    contentType: 'image/jpeg' | 'image/png';
  } | null>(null);

  const resetDraft = (discard = true) => {
    if (discard && pendingObjectPath) {
      discardUpload.mutate({ data: { objectPath: pendingObjectPath } });
    }
    setPendingObjectPath(null);
    setUploadFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setUploadState('idle');
    setDraftDoc(null);
    setErrorMsg('');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (pendingObjectPath) {
      discardUpload.mutate({ data: { objectPath: pendingObjectPath } });
      setPendingObjectPath(null);
    }
    
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setErrorMsg('Only JPEG and PNG files are allowed.');
      setUploadState('error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrorMsg('File must be less than 10MB.');
      setUploadState('error');
      return;
    }

    setUploadFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setUploadState('uploading');
    setErrorMsg('');

    try {
      // 1. Request presigned URL
      const urlRes = await requestUploadUrl.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: file.type
        }
      });
      
      // 2. Upload file directly via PUT
      const putRes = await fetch(urlRes.uploadURL, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type
        },
        body: file
      });
      
      if (!putRes.ok) {
        if (putRes.status === 401) {
          window.location.href = `/api/login?returnTo=${encodeURIComponent(location)}`;
          return;
        }
        throw new Error('Failed to upload file to storage');
      }

      setPendingObjectPath(urlRes.objectPath);
      setUploadState('extracting');

      // 3. Extract Document Data
      const extRes = await extractDocument.mutateAsync({
        data: {
          objectPath: urlRes.objectPath,
          contentType: file.type as 'image/jpeg' | 'image/png'
        }
      });

      setDraftDoc({
        documentType: extRes.documentType,
        date: extRes.date || '',
        amountAed: extRes.amountAed || 0,
        vendorName: extRes.vendorName || '',
        description: extRes.description || '',
        warrantyExpiry: extRes.warrantyExpiry,
        vehicleId: null,
        objectPath: urlRes.objectPath,
        originalFileName: file.name,
        contentType: file.type as 'image/jpeg' | 'image/png'
      });
      setUploadState('extracted');

    } catch (err: any) {
      if (err?.response?.status === 401) {
        window.location.href = `/api/login?returnTo=${encodeURIComponent(location)}`;
        return;
      }
      setErrorMsg(err.message || 'An error occurred during upload.');
      setUploadState('error');
    }
  };

  const handleSave = async () => {
    if (!draftDoc) return;
    try {
      await createDocument.mutateAsync({
        id: client.id,
        data: {
          ...draftDoc,
          amountAed: Number(draftDoc.amountAed),
          vehicleId: draftDoc.vehicleId || null,
          warrantyExpiry: draftDoc.documentType === 'warranty_card' ? draftDoc.warrantyExpiry : null,
        }
      });
      listDocsQuery.refetch();
      resetDraft(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save document.');
    }
  };

  const groupedDocs = useMemo(() => {
    if (!listDocsQuery.data) return {};
    return listDocsQuery.data.reduce((acc, doc) => {
      if (!acc[doc.documentType]) acc[doc.documentType] = [];
      acc[doc.documentType].push(doc);
      return acc;
    }, {} as Record<string, typeof listDocsQuery.data>);
  }, [listDocsQuery.data]);

  const docTypeLabels: Record<string, string> = {
    service_bill: 'Service Bills',
    part_bill: 'Part Bills',
    warranty_card: 'Warranty Cards',
    parking_receipt: 'Parking Receipts'
  };

  return (
    <section className="mt-8">
      <SectionHeading 
        eyebrow="Client Documents" 
        title="File register" 
        detail="Upload and extract data from client bills, warranties, and receipts." 
        action={
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-sm bg-primary px-3 py-2 text-[10px] font-bold uppercase tracking-[.13em] text-primary-foreground transition hover:bg-primary/90">
            <UploadCloud size={13} /> Upload Document
            <input type="file" hidden accept="image/jpeg,image/png" onChange={handleFileChange} />
          </label>
        } 
      />

      {uploadState !== 'idle' && (
        <div className="mb-8 rounded-sm border border-secondary/60 bg-accent/40 p-5 grid sm:grid-cols-2 gap-5 items-start">
          <div>
            {previewUrl && <img src={previewUrl} alt="Preview" className="w-full max-h-64 object-contain rounded-sm border border-border" />}
          </div>
          <div className="flex flex-col gap-4">
            {(uploadState === 'uploading' || uploadState === 'extracting') && (
              <div className="flex flex-col items-center justify-center h-full p-10 text-center">
                <LoaderCircle size={32} className="animate-spin text-primary mb-3" />
                <p className="font-serif text-lg">{uploadState === 'uploading' ? 'Uploading file...' : 'Extracting data with AI...'}</p>
                <p className="text-sm text-muted-foreground mt-1">This takes just a moment.</p>
              </div>
            )}
            
            {uploadState === 'error' && (
              <div className="p-4 rounded-sm bg-destructive/10 border border-destructive/20 text-destructive text-sm flex flex-col gap-2">
                <p><strong>Error:</strong> {errorMsg}</p>
                <button type="button" onClick={() => resetDraft()} className="self-start text-xs underline font-bold uppercase tracking-[.1em]">Dismiss</button>
              </div>
            )}

            {uploadState === 'extracted' && draftDoc && (
              <div className="grid gap-3">
                <h4 className="font-serif text-xl mb-1">Verify Details</h4>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="field-label sm:col-span-2">
                    Document Type
                     <select className="field-input" value={draftDoc.documentType} onChange={(e) => setDraftDoc({ ...draftDoc, documentType: e.target.value as DocumentType, warrantyExpiry: e.target.value === 'warranty_card' ? draftDoc.warrantyExpiry : null })}>
                      <option value="service_bill">Service Bill</option>
                      <option value="part_bill">Part Bill</option>
                      <option value="warranty_card">Warranty Card</option>
                      <option value="parking_receipt">Parking Receipt</option>
                    </select>
                  </label>
                  
                  <label className="field-label">
                    Date
                    <input required type="date" className="field-input" value={draftDoc.date} onChange={(e) => setDraftDoc({ ...draftDoc, date: e.target.value })} />
                  </label>

                  <label className="field-label">
                    Amount (AED)
                    <input type="number" className="field-input" value={draftDoc.amountAed} onChange={(e) => setDraftDoc({ ...draftDoc, amountAed: Number(e.target.value) })} />
                  </label>

                  <label className="field-label sm:col-span-2">
                    Vendor Name
                    <input className="field-input" value={draftDoc.vendorName} onChange={(e) => setDraftDoc({ ...draftDoc, vendorName: e.target.value })} />
                  </label>

                  <label className="field-label sm:col-span-2">
                    Description
                    <input className="field-input" value={draftDoc.description} onChange={(e) => setDraftDoc({ ...draftDoc, description: e.target.value })} />
                  </label>

                  {draftDoc.documentType === 'warranty_card' && (
                    <label className="field-label sm:col-span-2">
                      Warranty Expiry
                      <input type="date" className="field-input" value={draftDoc.warrantyExpiry || ''} onChange={(e) => setDraftDoc({ ...draftDoc, warrantyExpiry: e.target.value })} />
                    </label>
                  )}

                  <label className="field-label sm:col-span-2">
                    Associated Vehicle (Optional)
                    <select className="field-input" value={draftDoc.vehicleId || ''} onChange={(e) => setDraftDoc({ ...draftDoc, vehicleId: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">None</option>
                      {client.vehicles.map(v => (
                        <option key={v.id} value={v.id}>{v.model} ({v.plate})</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="flex gap-2 justify-end mt-4">
                  <button type="button" onClick={() => resetDraft()} className="inline-flex items-center gap-1 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-[.13em] text-muted-foreground hover:bg-muted">
                    <X size={14} /> Clear
                  </button>
                  <button type="button" onClick={handleSave} disabled={createDocument.isPending || !draftDoc.date} className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2 text-xs font-bold uppercase tracking-[.13em] text-primary-foreground disabled:opacity-50">
                    {createDocument.isPending ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />} Confirm & Save
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {listDocsQuery.isLoading ? (
        <SkeletonRows count={3} />
      ) : listDocsQuery.isError ? (
        <QueryError onRetry={() => listDocsQuery.refetch()} />
      ) : !listDocsQuery.data?.length ? (
        <EmptyState title="No documents yet" detail="Upload bills and receipts to keep a digital record." />
      ) : (
        <div className="space-y-8 mt-6">
          {Object.entries(groupedDocs).map(([type, docs]) => {
            const total = docs.reduce((sum, d) => sum + Number(d.amountAed || 0), 0);
            
            // Check for parking receipt > 35 days warning
            let parkingWarning = false;
            let latestParkingDate: string | null = null;
            if (type === 'parking_receipt' && docs.length > 0) {
              const latestDateStr = [...docs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0].date;
              latestParkingDate = latestDateStr;
              const diffTime = new Date().getTime() - new Date(`${latestDateStr}T00:00:00`).getTime();
              const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
              if (diffDays > 35) parkingWarning = true;
            }

            return (
              <div key={type} className="rounded-sm border border-border bg-card">
                <div className="border-b border-border bg-muted/20 px-5 py-3 flex items-center justify-between">
                  <h3 className="font-serif text-lg">{docTypeLabels[type] || type}</h3>
                  <div className="flex items-center gap-4">
                    {latestParkingDate && <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Latest {format(new Date(`${latestParkingDate}T00:00:00`), 'dd MMM yyyy')}</span>}
                    {parkingWarning && <span className="text-[10px] font-bold uppercase tracking-widest text-amber-700 bg-amber-500/10 px-2 py-1 rounded">Over 35 days since last receipt</span>}
                    <span className="font-mono text-sm">Total: AED {total.toLocaleString()}</span>
                  </div>
                </div>
                <div className="divide-y hairline">
                  {docs.map(doc => {
                    const v = client.vehicles.find(v => v.id === doc.vehicleId);
                    return (
                      <div key={doc.id} className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-3">
                            <p className="font-semibold text-sm">{doc.vendorName}</p>
                            <span className="font-mono text-xs text-muted-foreground">{doc.date}</span>
                          </div>
                          <p className="mt-1 text-sm text-foreground/80">{doc.description}</p>
                          {v && <p className="mt-1.5 text-[11px] font-bold uppercase tracking-[.1em] text-muted-foreground">Vehicle: {v.model} ({v.plate})</p>}
                        </div>
                        <div className="flex items-center gap-4 whitespace-nowrap">
                          <span className="font-mono text-sm font-medium">AED {doc.amountAed.toLocaleString()}</span>
                          <div className="flex items-center gap-2 border-l border-border pl-4">
                            <a href={`/api/storage${doc.objectPath}`} target="_blank" rel="noreferrer" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-primary transition">View</a>
                            <a href={`/api/storage${doc.objectPath}?download=1`} className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-primary transition">Download</a>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}