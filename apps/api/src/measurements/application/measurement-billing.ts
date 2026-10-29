/**
 * Public OPERATIONS application contract for Billing.
 * Measurement persistence remains encapsulated; billing must not query msr.* directly.
 */
export {
  findMeasurementForBilling,
  listMeasurementItemsForBilling,
  lockMeasurementForBilling,
  customerAcceptanceBlockForBilling,
  type MeasurementForBillingRow,
  type MeasurementItemForBillingRow,
} from '../repositories/measurement-billing.persistence';
