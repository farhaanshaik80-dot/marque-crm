import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  CarFront,
  Edit3,
  Plus,
  Trash2,
  FileImage,
  UploadCloud,
  Download,
  LoaderCircle,
  Eye,
  History
} from 'lucide-react';
import {
  getGetClientQueryKey,
  getGetDashboardQueryKey,
  getListClientsQueryKey,
  useUpdateVehicle,
  useUpdateVehicleOdometer,
  useCreateMaintenanceItem,
  useUpdateMaintenanceItem,
  useDeleteMaintenanceItem,
  useDeleteVehicle,
  useUpdateVehicleMulkiya,
  useRequestUploadUrl,
  useDiscardUpload,
  type VehicleStatus,
  type VehicleInput,
  type MaintenanceItemInput,
  type MaintenanceItem
} from '@workspace/api-client-react';
import { useAuth } from '@workspace/replit-auth-web';
import { StatusPill, formatDate, relativeDue } from '@/components/MarqueUI';
import { useLocation } from 'wouter';

export function VehicleCard({ vehicle, clientId }: { vehicle: VehicleStatus; clientId: number }) {
  const [location] = useLocation();
  const { isAuthenticated, login } = useAuth();
  const queryClient = useQueryClient();
  
  const invalidateVehicleData = () => {
    queryClient.invalidateQueries({ queryKey: getGetClientQueryKey(clientId) });
    queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
  };
  
  const updateVehicle = useUpdateVehicle();
  const deleteVehicle = useDeleteVehicle();
  const updateOdometer = useUpdateVehicleOdometer();
  const updateMulkiya = useUpdateVehicleMulkiya();
  const requestUploadUrl = useRequestUploadUrl();
  const discardUpload = useDiscardUpload();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<VehicleInput>({ 
    model: vehicle.model, 
    plate: vehicle.plate, 
    registrationExpiry: vehicle.registrationExpiry?.slice(0, 10),
    insuranceExpiry: vehicle.insuranceExpiry?.slice(0, 10),
    lastServiceDate: vehicle.lastServiceDate?.slice(0, 10),
    nextServiceDue: vehicle.nextServiceDue?.slice(0, 10),
    currentOdometer: vehicle.currentOdometer, 
    serviceIntervalKm: vehicle.serviceIntervalKm,
  });
  const [odometerForm, setOdometerForm] = useState(vehicle.currentOdometer);
  const [uploadingMulkiya, setUploadingMulkiya] = useState(false);
  
  const save = () => updateVehicle.mutate({ id: vehicle.id, data: form }, { onSuccess: () => { invalidateVehicleData(); setEditing(false); } });

  const removeVehicle = () => {
    if (!window.confirm(`Remove ${vehicle.model || 'this vehicle'} (${vehicle.plate || 'no plate'})? This also deletes its maintenance history and documents.`)) return;
    deleteVehicle.mutate({ id: vehicle.id }, { onSuccess: () => invalidateVehicleData() });
  };
  
  const saveOdometer = () => {
    updateOdometer.mutate({ id: vehicle.id, data: { currentOdometer: odometerForm } }, {
      onSuccess: () => {
        setForm((current) => ({ ...current, currentOdometer: odometerForm }));
        invalidateVehicleData();
      }
    });
  };

  const handleMulkiyaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isAuthenticated) {
      login();
      return;
    }
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      alert('Only JPEG and PNG files are allowed.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('File must be less than 10MB.');
      return;
    }
    
    setUploadingMulkiya(true);
    try {
      const urlRes = await requestUploadUrl.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type }
      });
      
      const putRes = await fetch(urlRes.uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file
      });
      
      if (!putRes.ok) {
        if (putRes.status === 401) window.location.href = `/api/login?returnTo=${encodeURIComponent(location)}`;
        else throw new Error('Upload failed');
      }

      await updateMulkiya.mutateAsync({
        id: vehicle.id,
        data: {
          objectPath: urlRes.objectPath,
          originalFileName: file.name,
          contentType: file.type as 'image/jpeg' | 'image/png'
        }
      });
      invalidateVehicleData();
    } catch (err: any) {
      if (err?.response?.status === 401) {
        window.location.href = `/api/login?returnTo=${encodeURIComponent(location)}`;
      } else {
        alert(err.message || 'Error uploading mulkiya');
      }
    } finally {
      setUploadingMulkiya(false);
    }
  };

  const createMaintenanceItem = useCreateMaintenanceItem();
  const updateMaintenanceItem = useUpdateMaintenanceItem();
  const deleteMaintenanceItem = useDeleteMaintenanceItem();
  const [showMaintForm, setShowMaintForm] = useState(false);
  const [editMaintId, setEditMaintId] = useState<number | null>(null);
  const [uploadingMaintPhoto, setUploadingMaintPhoto] = useState(false);
  const blankMaintItem: MaintenanceItemInput = { itemType: 'maintenance', name: '', costAed: 0 };
  const [maintForm, setMaintForm] = useState<MaintenanceItemInput>(blankMaintItem);

  const startEditMaint = (item: MaintenanceItem) => {
    setEditMaintId(item.id);
    setMaintForm({
      itemType: item.itemType,
      name: item.name,
      costAed: item.costAed,
      changeIntervalKm: item.changeIntervalKm ?? undefined,
      currentKm: item.currentKm ?? undefined,
      photoObjectPath: item.photoObjectPath ?? undefined,
      photoOriginalFileName: item.photoOriginalFileName ?? undefined,
      photoContentType: item.photoContentType ?? undefined,
    });
    setShowMaintForm(true);
  };
  
  const saveMaint = () => {
    if (editMaintId) {
      updateMaintenanceItem.mutate({ id: editMaintId, data: maintForm }, {
        onSuccess: () => {
          setShowMaintForm(false); setEditMaintId(null); setMaintForm(blankMaintItem);
          invalidateVehicleData();
        }
      });
    } else {
      createMaintenanceItem.mutate({ id: vehicle.id, data: maintForm }, {
        onSuccess: () => {
          setShowMaintForm(false); setMaintForm(blankMaintItem);
          invalidateVehicleData();
        }
      });
    }
  };
  
  const deleteMaint = (id: number) => {
    deleteMaintenanceItem.mutate({ id }, { onSuccess: () => invalidateVehicleData() });
  };

  const setMaintField = (k: keyof MaintenanceItemInput, v: string | number) => {
    setMaintForm((prev) => ({ ...prev, [k]: v }));
  };

  const handleMaintenancePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isAuthenticated) { login(); return; }
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      alert('Choose a JPEG or PNG smaller than 10MB.');
      return;
    }
    setUploadingMaintPhoto(true);
    try {
      if (maintForm.photoObjectPath && !editMaintId) discardUpload.mutate({ data: { objectPath: maintForm.photoObjectPath } });
      const upload = await requestUploadUrl.mutateAsync({ data: { name: file.name, size: file.size, contentType: file.type } });
      const put = await fetch(upload.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!put.ok) throw new Error('Photo upload failed');
      setMaintForm((current) => ({
        ...current,
        photoObjectPath: upload.objectPath,
        photoOriginalFileName: file.name,
        photoContentType: file.type as 'image/jpeg' | 'image/png',
      }));
    } catch (error: any) {
      alert(error.message || 'Photo upload failed');
    } finally {
      setUploadingMaintPhoto(false);
    }
  };

  return (
    <div className="rounded-sm border border-border bg-card p-5 flex flex-col h-full" data-testid={`card-vehicle-${vehicle.id}`}>
      <div className="flex items-start gap-4">
        <div className="flex size-10 shrink-0 items-center justify-center bg-accent text-primary">
          <CarFront size={19} strokeWidth={1.5} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-serif text-xl">{vehicle.model || 'Vehicle details pending'}</h3>
              <p className="mt-1 font-mono text-[11px] tracking-[.12em] text-muted-foreground">{vehicle.plate || 'Plate not set'}</p>
            </div>
            <div className="flex items-center gap-3">
              <StatusPill status={vehicle.overallStatus} label={vehicle.overallStatus === 'green' ? 'Clear' : vehicle.overallStatus === 'amber' ? 'Review' : 'Action'} />
              <button type="button" onClick={() => setEditing((value) => !value)} className="rounded-sm p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground" data-testid={`button-edit-vehicle-${vehicle.id}`}>
                <Edit3 size={15} />
              </button>
              <button type="button" onClick={removeVehicle} disabled={deleteVehicle.isPending} className="rounded-sm p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50" data-testid={`button-delete-vehicle-${vehicle.id}`}>
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {editing ? (
        <div className="mt-6 grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
          <label className="field-label sm:col-span-2">Make and model<input className="field-input" value={form.model ?? ''} onChange={(event) => setForm((current) => ({ ...current, model: event.target.value || undefined }))} data-testid={`input-edit-vehicle-model-${vehicle.id}`} /></label>
          <label className="field-label">Plate<input className="field-input" value={form.plate ?? ''} onChange={(event) => setForm((current) => ({ ...current, plate: event.target.value || undefined }))} data-testid={`input-edit-vehicle-plate-${vehicle.id}`} /></label>
          <label className="field-label">Registration<input type="date" className="field-input" value={form.registrationExpiry ?? ''} onChange={(event) => setForm((current) => ({ ...current, registrationExpiry: event.target.value || undefined }))} data-testid={`input-edit-registration-${vehicle.id}`} /></label>
          <label className="field-label">Insurance<input type="date" className="field-input" value={form.insuranceExpiry ?? ''} onChange={(event) => setForm((current) => ({ ...current, insuranceExpiry: event.target.value || undefined }))} data-testid={`input-edit-insurance-${vehicle.id}`} /></label>
          <label className="field-label">Next service date<input type="date" className="field-input" value={form.nextServiceDue ?? ''} onChange={(event) => setForm((current) => ({ ...current, nextServiceDue: event.target.value || undefined }))} data-testid={`input-edit-service-${vehicle.id}`} /></label>
          <label className="field-label">Current odometer (km)<input type="number" min="0" className="field-input" value={form.currentOdometer ?? ''} onChange={(event) => setForm((current) => ({ ...current, currentOdometer: event.target.value === '' ? undefined : Number(event.target.value) }))} data-testid={`input-edit-current-odometer-${vehicle.id}`} /></label>
          <label className="field-label">Service interval (km)<input type="number" min="0" className="field-input" value={form.serviceIntervalKm ?? ''} onChange={(event) => setForm((current) => ({ ...current, serviceIntervalKm: event.target.value === '' ? undefined : Number(event.target.value) }))} data-testid={`input-edit-service-interval-${vehicle.id}`} /></label>
          <label className="field-label">Calculated next service due (km)<input type="number" className="field-input bg-muted opacity-70 cursor-not-allowed" readOnly value={form.serviceIntervalKm ? (form.currentOdometer ?? 0) + form.serviceIntervalKm : ''} data-testid={`input-edit-service-odometer-${vehicle.id}`} /></label>
          <div className="sm:col-span-2 flex justify-end">
            <button type="button" onClick={save} disabled={updateVehicle.isPending} className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2 text-xs font-bold uppercase tracking-[.13em] text-primary-foreground disabled:opacity-50" data-testid={`button-save-vehicle-${vehicle.id}`}>
              {updateVehicle.isPending ? 'Saving' : 'Save vehicle'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-6 border-t border-border pt-5 flex-1 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-5 bg-muted/30 p-3 rounded-sm">
            <div className="flex items-center gap-3">
               <span className="text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">Current Odometer</span>
               <div className="flex items-center gap-2">
                 <input type="number" value={odometerForm} onChange={(e) => setOdometerForm(Number(e.target.value))} className="field-input w-28 h-8 min-h-0 text-xs py-1 px-2" data-testid={`input-odometer-${vehicle.id}`} />
                 <button type="button" onClick={saveOdometer} disabled={updateOdometer.isPending} className="rounded-sm bg-secondary px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.1em] text-secondary-foreground disabled:opacity-50 hover:bg-secondary/90 transition" data-testid={`button-update-odometer-${vehicle.id}`}>
                  {updateOdometer.isPending ? 'Wait' : 'Update'}
                 </button>
               </div>
            </div>
            <div className="text-[10px] text-muted-foreground">
              Last checked: {vehicle.odometerUpdatedAt ? formatDate(vehicle.odometerUpdatedAt) : 'Never'}
            </div>
          </div>
          
          <div className="grid gap-4 sm:grid-cols-3 mb-6">
            {vehicle.dueItems.filter(i => i.kind !== 'odometer-checkin').map((item) => (
              <div key={item.kind}>
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">
                  <CalendarDays size={12} /> {item.label}
                </div>
                <p className={`mt-2 font-mono text-xs ${item.status === 'red' ? 'text-destructive' : item.status === 'amber' ? 'text-amber-600' : 'text-foreground'}`}>
                  {relativeDue(item.daysUntilDue, item.kmUntilDue)}
                </p>
                {item.dueDate && <p className="mt-1 text-[11px] text-muted-foreground">{formatDate(item.dueDate)}</p>}
              </div>
            ))}
          </div>
          {vehicle.serviceIntervalKm > 0 && (
            <p className="mb-6 text-xs text-muted-foreground">
              Service interval: <span className="font-mono text-foreground">{vehicle.serviceIntervalKm.toLocaleString()} km</span>
              <span className="mx-2 text-border">·</span>
              Next due at <span className="font-mono text-foreground">{vehicle.nextServiceDueOdometer.toLocaleString()} km</span>
            </p>
          )}

          <div className="mb-6">
            <h4 className="text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground mb-3 flex items-center gap-2">
              <FileImage size={12} /> Vehicle Mulkiya
            </h4>
            {vehicle.mulkiyaImagePath ? (
              <div className="flex items-center gap-3">
                <a href={`/api/storage${vehicle.mulkiyaImagePath}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-sm border border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-foreground hover:bg-muted transition">
                  <Eye size={12} /> View Document
                </a>
                <a href={`/api/storage${vehicle.mulkiyaImagePath}?download=1`} className="inline-flex items-center gap-2 rounded-sm border border-border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-foreground hover:bg-muted transition">
                  <Download size={12} /> Download
                </a>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition ml-auto">
                  {uploadingMulkiya ? <LoaderCircle size={12} className="animate-spin" /> : <UploadCloud size={12} />} Replace
                  <input type="file" hidden accept="image/jpeg,image/png" onChange={handleMulkiyaUpload} disabled={uploadingMulkiya} />
                </label>
              </div>
            ) : (
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-sm border border-dashed border-border px-4 py-2.5 text-xs font-bold uppercase tracking-[.1em] text-muted-foreground hover:border-primary hover:text-primary transition bg-muted/10 hover:bg-muted/30 w-full justify-center">
                {uploadingMulkiya ? <LoaderCircle size={14} className="animate-spin" /> : <UploadCloud size={14} />} 
                {uploadingMulkiya ? 'Uploading...' : 'Upload Mulkiya (JPEG/PNG)'}
                <input type="file" hidden accept="image/jpeg,image/png" onChange={handleMulkiyaUpload} disabled={uploadingMulkiya} />
              </label>
            )}
          </div>
          
          <div className="border-t hairline pt-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground">Flexible Maintenance</h4>
              <button type="button" onClick={() => { setEditMaintId(null); setMaintForm(blankMaintItem); setShowMaintForm(!showMaintForm); }} className="text-[10px] font-bold uppercase tracking-[.12em] text-foreground hover:text-primary transition flex items-center gap-1" data-testid={`button-add-maint-${vehicle.id}`}>
                <Plus size={12} /> Add item
              </button>
            </div>
            {showMaintForm && (
              <div className="mb-4 rounded-sm border border-border bg-muted/20 p-4 grid gap-3 sm:grid-cols-2">
                <label className="field-label sm:col-span-2">Item type<select className="field-input" value={maintForm.itemType} onChange={(e) => setMaintForm((current) => ({ ...current, itemType: e.target.value as 'maintenance' | 'payment', currentKm: undefined, changeIntervalKm: undefined }))} data-testid="select-maint-type"><option value="maintenance">Maintenance</option><option value="payment">Payment</option></select></label>
                <label className="field-label sm:col-span-2">Item Name<input className="field-input" value={maintForm.name} onChange={(e) => setMaintField('name', e.target.value)} data-testid="input-maint-name" placeholder="e.g. Brake Pads" /></label>
                <label className="field-label">Cost (AED)<input type="number" className="field-input" value={maintForm.costAed || ''} onChange={(e) => setMaintField('costAed', Number(e.target.value))} data-testid="input-maint-cost" /></label>
                {maintForm.itemType === 'maintenance' && <><label className="field-label">Current km<input type="number" className="field-input" value={maintForm.currentKm ?? ''} onChange={(e) => setMaintForm((current) => ({ ...current, currentKm: e.target.value === '' ? undefined : Number(e.target.value) }))} data-testid="input-maint-current-km" /></label><label className="field-label">Interval (km, optional)<input type="number" className="field-input" value={maintForm.changeIntervalKm ?? ''} onChange={(e) => setMaintForm((current) => ({ ...current, changeIntervalKm: e.target.value === '' ? undefined : Number(e.target.value) }))} data-testid="input-maint-interval" /></label></>}
                <label className="field-label sm:col-span-2">Photo (optional)<span className="field-input inline-flex items-center gap-2 cursor-pointer"><UploadCloud size={14} />{uploadingMaintPhoto ? 'Uploading…' : maintForm.photoOriginalFileName || 'Upload JPEG/PNG'}<input type="file" hidden accept="image/jpeg,image/png" onChange={handleMaintenancePhoto} disabled={uploadingMaintPhoto} data-testid="input-maint-photo" /></span></label>
                <div className="sm:col-span-2 flex justify-end gap-2 mt-2">
                  <button type="button" onClick={() => setShowMaintForm(false)} className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                  <button type="button" onClick={saveMaint} disabled={!maintForm.name || uploadingMaintPhoto || createMaintenanceItem.isPending || updateMaintenanceItem.isPending} className="rounded-sm bg-primary px-4 py-1.5 text-xs font-bold uppercase tracking-[.1em] text-primary-foreground disabled:opacity-50">{uploadingMaintPhoto ? 'Uploading photo…' : 'Save Item'}</button>
                </div>
              </div>
            )}
            {vehicle.maintenanceItems.length > 0 ? (
              <div className="divide-y hairline">
                {vehicle.maintenanceItems.map(item => (
                  <div key={item.id} className="py-3 flex items-center justify-between gap-3 group">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-semibold text-foreground">{item.name}</p>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{item.itemType}</span>
                        <StatusPill status={item.status} label={item.status === 'green' ? 'OK' : item.status === 'amber' ? 'Soon' : 'Due'} />
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {item.itemType === 'maintenance' && item.currentKm != null && <>Recorded at {item.currentKm.toLocaleString()}km <span className="mx-1 text-border">·</span></>}
                        {item.kmRemaining != null && <>Due in {item.kmRemaining.toLocaleString()}km <span className="mx-1 text-border">·</span></>}
                        AED {item.costAed} <span className="mx-1 text-border">·</span> {formatDate(item.dateRecorded)}
                      </p>
                      {item.photoObjectPath && <div className="mt-1 flex gap-3"><a href={`/api/storage${item.photoObjectPath}`} target="_blank" rel="noreferrer" className="text-[10px] font-bold uppercase tracking-wider text-primary">View photo</a><a href={`/api/storage${item.photoObjectPath}?download=1`} className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Download</a></div>}
                    </div>
                     <div className="flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <button type="button" onClick={() => startEditMaint(item)} className="p-1.5 text-muted-foreground hover:text-primary transition" aria-label="Edit"><Edit3 size={14} /></button>
                      <button type="button" onClick={() => deleteMaint(item.id)} className="p-1.5 text-muted-foreground hover:text-destructive transition" aria-label="Delete"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">No flexible maintenance items tracked.</p>
            )}
          </div>

          <div className="border-t hairline pt-5 mt-auto">
            <h4 className="text-[10px] font-bold uppercase tracking-[.15em] text-muted-foreground mb-4 flex items-center gap-2">
              <History size={12} /> Update Timeline
            </h4>
            {vehicle.updateHistory?.length > 0 ? (
              <div className="relative border-l border-border ml-2 space-y-4 pb-2">
                {[...vehicle.updateHistory].sort((a,b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime()).map(h => {
                  const humanField = h.fieldChanged === 'reminder_sent' ? 'Reminder sent' : h.fieldChanged.replace(/([A-Z])/g, ' $1').replaceAll('_', ' ').toLowerCase();
                  const isOdometer = h.fieldChanged.toLowerCase().includes('odometer');
                  return (
                    <div key={h.id} className="relative pl-4">
                      <div className="absolute w-2 h-2 bg-border rounded-full -left-[4.5px] top-1.5"></div>
                      <p className="text-xs font-medium capitalize">{humanField}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {h.fieldChanged === 'reminder_sent' ? h.newValue : <>{h.oldValue || 'None'} → {h.newValue} {isOdometer && 'km'}</>}
                      </p>
                      <p className="text-[9px] text-muted-foreground/60 mt-1 font-mono">{formatDate(h.changedAt)}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic ml-2">No updates recorded yet.</p>
            )}
          </div>
          
        </div>
      )}
    </div>
  );
}