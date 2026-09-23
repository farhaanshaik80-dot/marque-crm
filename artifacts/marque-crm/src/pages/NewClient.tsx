import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, LoaderCircle } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { getGetDashboardQueryKey, getListClientsQueryKey, useCreateClient, type ClientInput, type VehicleInput } from '@workspace/api-client-react';

const blankVehicle: VehicleInput = {};

function errorMessage(error: unknown): string {
  const apiError = error as { data?: { error?: string } | null; message?: string };
  return apiError.data?.error ?? apiError.message ?? 'We couldn’t create this record.';
}

export default function NewClient() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const createClient = useCreateClient();
  const [form, setForm] = useState<ClientInput>({ name: '', phone: '', vehicles: [{ ...blankVehicle }] });

  const update = (key: keyof ClientInput, value: string | number | undefined) => setForm((current) => ({ ...current, [key]: value }));
  const updateVehicle = (key: keyof VehicleInput, value: string | number | undefined) => setForm((current) => ({ ...current, vehicles: [{ ...(current.vehicles?.[0] ?? {}), [key]: value }] }));
  const vehicle = form.vehicles?.[0] ?? blankVehicle;
  const hasVehicleDetails = Object.values(vehicle).some((value) => value !== undefined && value !== '');
  const submit = () => {
    const payload: ClientInput = {
      ...form,
      name: form.name.trim(),
      phone: form.phone.trim(),
      tier: form.tier || undefined,
      vehicles: hasVehicleDetails ? [vehicle] : undefined,
    };
    createClient.mutate({ data: payload }, { onSuccess: (client) => { queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() }); queryClient.invalidateQueries({ queryKey: getListClientsQueryKey() }); setLocation(`/clients/${client.id}`); } });
  };
  const requiredFieldsComplete = Boolean(form.name.trim() && form.phone.trim());
  const calculatedServiceDue = (vehicle.currentOdometer ?? 0) + (vehicle.serviceIntervalKm ?? 0);

  return <div className="min-h-[calc(100dvh-72px)] bg-background">
    <div className="mx-auto max-w-[1080px] p-5 sm:p-8 lg:p-11">
      <Link href="/" className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.15em] text-muted-foreground transition hover:text-foreground" data-testid="link-back-dashboard"><ArrowLeft size={14} /> Back to desk</Link>
      <div className="mt-8 grid gap-10 lg:grid-cols-[.7fr_1.3fr]">
        <div>
          <p className="eyebrow">New relationship</p>
          <h1 className="mt-2 max-w-sm font-serif text-4xl leading-tight text-foreground">Make the first impression count.</h1>
          <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">Add the essentials for a new client and their first vehicle.</p>
        </div>
        <div className="rounded-sm border border-border bg-card p-5 sm:p-8">
          <div>
            <p className="eyebrow">Client details</p>
            <h2 className="mt-2 font-serif text-2xl">A clear starting point.</h2>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="field-label">Client name *<input value={form.name} onChange={(event) => update('name', event.target.value)} className="field-input" data-testid="input-client-name" /></label>
            <label className="field-label">Phone *<input type="tel" value={form.phone} onChange={(event) => update('phone', event.target.value)} className="field-input" placeholder="+971 50 123 4567" data-testid="input-client-phone" /></label>
            <label className="field-label sm:col-span-2">Tier (optional)<select value={form.tier ?? ''} onChange={(event) => update('tier', event.target.value || undefined)} className="field-input" data-testid="select-client-tier"><option value="">Not set</option><option>Signature</option><option>Private Office</option><option>House Account</option></select></label>
          </div>
          <div className="mt-7 border-t border-border pt-6">
            <p className="eyebrow">First vehicle</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="field-label sm:col-span-2">Make and model (optional)<input value={vehicle.model ?? ''} onChange={(event) => updateVehicle('model', event.target.value || undefined)} className="field-input" placeholder="2021 Range Rover Autobiography" data-testid="input-vehicle-model" /></label>
              <label className="field-label">Plate (optional)<input value={vehicle.plate ?? ''} onChange={(event) => updateVehicle('plate', event.target.value || undefined)} className="field-input" data-testid="input-vehicle-plate" /></label>
              <label className="field-label">Registration expiry (optional)<input type="date" value={vehicle.registrationExpiry ?? ''} onChange={(event) => updateVehicle('registrationExpiry', event.target.value || undefined)} className="field-input" data-testid="input-registration-expiry" /></label>
              <label className="field-label">Insurance expiry (optional)<input type="date" value={vehicle.insuranceExpiry ?? ''} onChange={(event) => updateVehicle('insuranceExpiry', event.target.value || undefined)} className="field-input" data-testid="input-insurance-expiry" /></label>
              <label className="field-label">Next service due date (optional)<input type="date" value={vehicle.nextServiceDue ?? ''} onChange={(event) => updateVehicle('nextServiceDue', event.target.value || undefined)} className="field-input" data-testid="input-service-due" /></label>
              <label className="field-label">Current odometer (km, optional)<input type="number" min="0" value={vehicle.currentOdometer ?? ''} onChange={(event) => updateVehicle('currentOdometer', event.target.value === '' ? undefined : Number(event.target.value))} className="field-input" data-testid="input-current-odometer" /></label>
              <label className="field-label">Service interval (km, optional)<input type="number" min="0" value={vehicle.serviceIntervalKm ?? ''} onChange={(event) => updateVehicle('serviceIntervalKm', event.target.value === '' ? undefined : Number(event.target.value))} className="field-input" data-testid="input-service-interval" /></label>
              <label className="field-label">Calculated next service due (km)<input type="number" readOnly value={vehicle.serviceIntervalKm ? calculatedServiceDue : ''} className="field-input bg-muted opacity-70 cursor-not-allowed" data-testid="input-next-service-odometer" /></label>
            </div>
          </div>
          <div className="mt-7 flex justify-end">
            <button type="button" disabled={!requiredFieldsComplete || createClient.isPending} onClick={submit} className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2.5 text-xs font-bold uppercase tracking-[.13em] text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-create-client">{createClient.isPending && <LoaderCircle size={14} className="animate-spin" />}{createClient.isPending ? 'Creating record' : 'Create client record'}</button>
          </div>
          {createClient.isError && <p className="mt-3 text-xs text-red-700" data-testid="status-create-client-error">{errorMessage(createClient.error)}</p>}
        </div>
      </div>
    </div>
  </div>;
}