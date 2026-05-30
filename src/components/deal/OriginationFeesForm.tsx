import React, { useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { DirtyFieldWrapper } from './DirtyFieldWrapper';
import { RE885ProposedLoanTerms } from './RE885ProposedLoanTerms';
import { numericKeyDown, numericPaste, formatCurrencyDisplay, unformatCurrencyDisplay } from '@/lib/numericInputFilter';
import type { CalculationResult } from '@/lib/calculationEngine';

interface OriginationFeesFormProps {
  values: Record<string, string>;
  onValueChange: (fieldKey: string, value: string) => void;
  showValidation?: boolean;
  disabled?: boolean;
  calculationResults?: Record<string, CalculationResult>;
}

// Field keys for Origination Fees (HUD-1 form)
const FIELD_KEYS = {
  // 800 Items Payable in Connection with Loan
  lendersLoanOriginationFee_payable_to: 'origination_fees.801_lenders_loan_origination_fee_payable_to',
  lendersLoanOriginationFee_d: 'origination_fees.801_lenders_loan_origination_fee_d',
  lendersLoanOriginationFee_charge: 'origination_fees.801_lenders_loan_origination_fee_charge',
  lendersLoanOriginationFee_broker: 'origination_fees.801_lenders_loan_origination_fee_broker',
  lendersLoanOriginationFee_others: 'origination_fees.801_lenders_loan_origination_fee_others',
  lendersLoanOriginationFee_apr: 'origination_fees.801_lenders_loan_origination_fee_apr',
  lendersLoanOriginationFee_paid_to_company: 'origination_fees.801_lenders_loan_origination_fee_paid_to_company',
  lendersLoanOriginationFee_oral_disclosure: 'origination_fees.801_lenders_loan_origination_fee_oral_disclosure',

  lendersLoanDiscountFee_payable_to: 'origination_fees.802_lenders_loan_discount_fee_payable_to',
  lendersLoanDiscountFee_d: 'origination_fees.802_lenders_loan_discount_fee_d',
  lendersLoanDiscountFee_charge: 'origination_fees.802_lenders_loan_discount_fee_charge',
  lendersLoanDiscountFee_broker: 'origination_fees.802_lenders_loan_discount_fee_broker',
  lendersLoanDiscountFee_others: 'origination_fees.802_lenders_loan_discount_fee_others',
  lendersLoanDiscountFee_apr: 'origination_fees.802_lenders_loan_discount_fee_apr',
  lendersLoanDiscountFee_paid_to_company: 'origination_fees.802_lenders_loan_discount_fee_paid_to_company',
  lendersLoanDiscountFee_oral_disclosure: 'origination_fees.802_lenders_loan_discount_fee_oral_disclosure',

  appraisalFee_payable_to: 'origination_fees.803_appraisal_fee_payable_to',
  appraisalFee_d: 'origination_fees.803_appraisal_fee_d',
  appraisalFee_charge: 'origination_fees.803_appraisal_fee_charge',
  appraisalFee_broker: 'origination_fees.803_appraisal_fee_broker',
  appraisalFee_others: 'origination_fees.803_appraisal_fee_others',
  appraisalFee_apr: 'origination_fees.803_appraisal_fee_apr',
  appraisalFee_paid_to_company: 'origination_fees.803_appraisal_fee_paid_to_company',
  appraisalFee_oral_disclosure: 'origination_fees.803_appraisal_fee_oral_disclosure',

  creditReport_payable_to: 'origination_fees.804_credit_report_payable_to',
  creditReport_d: 'origination_fees.804_credit_report_d',
  creditReport_charge: 'origination_fees.804_credit_report_charge',
  creditReport_broker: 'origination_fees.804_credit_report_broker',
  creditReport_others: 'origination_fees.804_credit_report_others',
  creditReport_apr: 'origination_fees.804_credit_report_apr',
  creditReport_paid_to_company: 'origination_fees.804_credit_report_paid_to_company',
  creditReport_oral_disclosure: 'origination_fees.804_credit_report_oral_disclosure',

  lendersInspectionFee_payable_to: 'origination_fees.805_lenders_inspection_fee_payable_to',
  lendersInspectionFee_d: 'origination_fees.805_lenders_inspection_fee_d',
  lendersInspectionFee_charge: 'origination_fees.805_lenders_inspection_fee_charge',
  lendersInspectionFee_broker: 'origination_fees.805_lenders_inspection_fee_broker',
  lendersInspectionFee_others: 'origination_fees.805_lenders_inspection_fee_others',
  lendersInspectionFee_apr: 'origination_fees.805_lenders_inspection_fee_apr',
  lendersInspectionFee_paid_to_company: 'origination_fees.805_lenders_inspection_fee_paid_to_company',
  lendersInspectionFee_oral_disclosure: 'origination_fees.805_lenders_inspection_fee_oral_disclosure',

  mortgageBrokerFee_payable_to: 'origination_fees.808_mortgage_broker_fee_payable_to',
  mortgageBrokerFee_d: 'origination_fees.808_mortgage_broker_fee_d',
  mortgageBrokerFee_charge: 'origination_fees.808_mortgage_broker_fee_charge',
  mortgageBrokerFee_broker: 'origination_fees.808_mortgage_broker_fee_broker',
  mortgageBrokerFee_others: 'origination_fees.808_mortgage_broker_fee_others',
  mortgageBrokerFee_apr: 'origination_fees.808_mortgage_broker_fee_apr',
  mortgageBrokerFee_paid_to_company: 'origination_fees.808_mortgage_broker_fee_paid_to_company',
  mortgageBrokerFee_oral_disclosure: 'origination_fees.808_mortgage_broker_fee_oral_disclosure',

  taxServiceFee_payable_to: 'origination_fees.809_tax_service_fee_payable_to',
  taxServiceFee_d: 'origination_fees.809_tax_service_fee_d',
  taxServiceFee_charge: 'origination_fees.809_tax_service_fee_charge',
  taxServiceFee_broker: 'origination_fees.809_tax_service_fee_broker',
  taxServiceFee_others: 'origination_fees.809_tax_service_fee_others',
  taxServiceFee_apr: 'origination_fees.809_tax_service_fee_apr',
  taxServiceFee_paid_to_company: 'origination_fees.809_tax_service_fee_paid_to_company',
  taxServiceFee_oral_disclosure: 'origination_fees.809_tax_service_fee_oral_disclosure',

  processingFee_payable_to: 'origination_fees.810_processing_fee_payable_to',
  processingFee_d: 'origination_fees.810_processing_fee_d',
  processingFee_charge: 'origination_fees.810_processing_fee_charge',
  processingFee_broker: 'origination_fees.810_processing_fee_broker',
  processingFee_others: 'origination_fees.810_processing_fee_others',
  processingFee_apr: 'origination_fees.810_processing_fee_apr',
  processingFee_paid_to_company: 'origination_fees.810_processing_fee_paid_to_company',
  processingFee_oral_disclosure: 'origination_fees.810_processing_fee_oral_disclosure',

  underwritingFee_payable_to: 'origination_fees.811_underwriting_fee_payable_to',
  underwritingFee_d: 'origination_fees.811_underwriting_fee_d',
  underwritingFee_charge: 'origination_fees.811_underwriting_fee_charge',
  underwritingFee_broker: 'origination_fees.811_underwriting_fee_broker',
  underwritingFee_others: 'origination_fees.811_underwriting_fee_others',
  underwritingFee_apr: 'origination_fees.811_underwriting_fee_apr',
  underwritingFee_paid_to_company: 'origination_fees.811_underwriting_fee_paid_to_company',
  underwritingFee_oral_disclosure: 'origination_fees.811_underwriting_fee_oral_disclosure',

  wireTransferFee_payable_to: 'origination_fees.812_wire_transfer_fee_payable_to',
  wireTransferFee_d: 'origination_fees.812_wire_transfer_fee_d',
  wireTransferFee_charge: 'origination_fees.812_wire_transfer_fee_charge',
  wireTransferFee_broker: 'origination_fees.812_wire_transfer_fee_broker',
  wireTransferFee_others: 'origination_fees.812_wire_transfer_fee_others',
  wireTransferFee_apr: 'origination_fees.812_wire_transfer_fee_apr',
  wireTransferFee_paid_to_company: 'origination_fees.812_wire_transfer_fee_paid_to_company',
  wireTransferFee_oral_disclosure: 'origination_fees.812_wire_transfer_fee_oral_disclosure',

  customItem800_label: 'origination_fees.800_custom_item_label',
  customItem800_payable_to: 'origination_fees.800_custom_item_payable_to',
  customItem800_d: 'origination_fees.800_custom_item_d',
  customItem800_charge: 'origination_fees.800_custom_item_charge',
  customItem800_broker: 'origination_fees.800_custom_item_broker',
  customItem800_others: 'origination_fees.800_custom_item_others',
  customItem800_apr: 'origination_fees.800_custom_item_apr',
  customItem800_paid_to_company: 'origination_fees.800_custom_item_paid_to_company',
  customItem800_oral_disclosure: 'origination_fees.800_custom_item_oral_disclosure',

  // 900 Items Required by Lender to be Paid in Advance
  interestForDays_payable_to: 'origination_fees.901_interest_for_days_payable_to',
  interestForDays_d: 'origination_fees.901_interest_for_days_d',
  interestForDays_charge: 'origination_fees.901_interest_for_days_charge',
  interestForDays_broker: 'origination_fees.901_interest_for_days_broker',
  interestForDays_others: 'origination_fees.901_interest_for_days_others',
  interestForDays_apr: 'origination_fees.901_interest_for_days_apr',
  interestForDays_paid_to_company: 'origination_fees.901_interest_for_days_paid_to_company',
  interestForDays_oral_disclosure: 'origination_fees.901_interest_for_days_oral_disclosure',

  mortgageInsurancePremiums_payable_to: 'origination_fees.902_mortgage_insurance_premiums_payable_to',
  mortgageInsurancePremiums_d: 'origination_fees.902_mortgage_insurance_premiums_d',
  mortgageInsurancePremiums_charge: 'origination_fees.902_mortgage_insurance_premiums_charge',
  mortgageInsurancePremiums_broker: 'origination_fees.902_mortgage_insurance_premiums_broker',
  mortgageInsurancePremiums_others: 'origination_fees.902_mortgage_insurance_premiums_others',
  mortgageInsurancePremiums_apr: 'origination_fees.902_mortgage_insurance_premiums_apr',
  mortgageInsurancePremiums_paid_to_company: 'origination_fees.902_mortgage_insurance_premiums_paid_to_company',
  mortgageInsurancePremiums_oral_disclosure: 'origination_fees.902_mortgage_insurance_premiums_oral_disclosure',

  hazardInsurancePremiums_payable_to: 'origination_fees.903_hazard_insurance_premiums_payable_to',
  hazardInsurancePremiums_d: 'origination_fees.903_hazard_insurance_premiums_d',
  hazardInsurancePremiums_charge: 'origination_fees.903_hazard_insurance_premiums_charge',
  hazardInsurancePremiums_broker: 'origination_fees.903_hazard_insurance_premiums_broker',
  hazardInsurancePremiums_others: 'origination_fees.903_hazard_insurance_premiums_others',
  hazardInsurancePremiums_apr: 'origination_fees.903_hazard_insurance_premiums_apr',
  hazardInsurancePremiums_paid_to_company: 'origination_fees.903_hazard_insurance_premiums_paid_to_company',
  hazardInsurancePremiums_oral_disclosure: 'origination_fees.903_hazard_insurance_premiums_oral_disclosure',

  countyPropertyTaxes_payable_to: 'origination_fees.904_county_property_taxes_payable_to',
  countyPropertyTaxes_d: 'origination_fees.904_county_property_taxes_d',
  countyPropertyTaxes_charge: 'origination_fees.904_county_property_taxes_charge',
  countyPropertyTaxes_broker: 'origination_fees.904_county_property_taxes_broker',
  countyPropertyTaxes_others: 'origination_fees.904_county_property_taxes_others',
  countyPropertyTaxes_apr: 'origination_fees.904_county_property_taxes_apr',
  countyPropertyTaxes_paid_to_company: 'origination_fees.904_county_property_taxes_paid_to_company',
  countyPropertyTaxes_oral_disclosure: 'origination_fees.904_county_property_taxes_oral_disclosure',

  vaFundingFee_payable_to: 'origination_fees.905_va_funding_fee_payable_to',
  vaFundingFee_d: 'origination_fees.905_va_funding_fee_d',
  vaFundingFee_charge: 'origination_fees.905_va_funding_fee_charge',
  vaFundingFee_broker: 'origination_fees.905_va_funding_fee_broker',
  vaFundingFee_others: 'origination_fees.905_va_funding_fee_others',
  vaFundingFee_apr: 'origination_fees.905_va_funding_fee_apr',
  vaFundingFee_paid_to_company: 'origination_fees.905_va_funding_fee_paid_to_company',
  vaFundingFee_oral_disclosure: 'origination_fees.905_va_funding_fee_oral_disclosure',

  customItem900_label: 'origination_fees.900_custom_item_label',
  customItem900_payable_to: 'origination_fees.900_custom_item_payable_to',
  customItem900_d: 'origination_fees.900_custom_item_d',
  customItem900_charge: 'origination_fees.900_custom_item_charge',
  customItem900_broker: 'origination_fees.900_custom_item_broker',
  customItem900_others: 'origination_fees.900_custom_item_others',
  customItem900_apr: 'origination_fees.900_custom_item_apr',
  customItem900_paid_to_company: 'origination_fees.900_custom_item_paid_to_company',
  customItem900_oral_disclosure: 'origination_fees.900_custom_item_oral_disclosure',

  // 1000 Reserves Deposited with Lender or Other
  hazardInsurance_months: 'origination_fees.1001_hazard_insurance_months',
  hazardInsurance_perMonth: 'origination_fees.1001_hazard_insurance_per_month',
  hazardInsurance_total: 'origination_fees.1001_hazard_insurance_total',
  hazardInsurance_charge: 'origination_fees.1001_hazard_insurance_charge',
  hazardInsurance_broker: 'origination_fees.1001_hazard_insurance_broker',
  hazardInsurance_others: 'origination_fees.1001_hazard_insurance_others',
  hazardInsurance_apr: 'origination_fees.1001_hazard_insurance_apr',
  hazardInsurance_paid_to_company: 'origination_fees.1001_hazard_insurance_paid_to_company',
  hazardInsurance_oral_disclosure: 'origination_fees.1001_hazard_insurance_oral_disclosure',

  mortgageInsurance_months: 'origination_fees.1002_mortgage_insurance_months',
  mortgageInsurance_perMonth: 'origination_fees.1002_mortgage_insurance_per_month',
  mortgageInsurance_total: 'origination_fees.1002_mortgage_insurance_total',
  mortgageInsurance_charge: 'origination_fees.1002_mortgage_insurance_charge',
  mortgageInsurance_broker: 'origination_fees.1002_mortgage_insurance_broker',
  mortgageInsurance_others: 'origination_fees.1002_mortgage_insurance_others',
  mortgageInsurance_apr: 'origination_fees.1002_mortgage_insurance_apr',
  mortgageInsurance_paid_to_company: 'origination_fees.1002_mortgage_insurance_paid_to_company',
  mortgageInsurance_oral_disclosure: 'origination_fees.1002_mortgage_insurance_oral_disclosure',

  coPropertyTaxes_months: 'origination_fees.1004_co_property_taxes_months',
  coPropertyTaxes_perMonth: 'origination_fees.1004_co_property_taxes_per_month',
  coPropertyTaxes_total: 'origination_fees.1004_co_property_taxes_total',
  coPropertyTaxes_charge: 'origination_fees.1004_co_property_taxes_charge',
  coPropertyTaxes_broker: 'origination_fees.1004_co_property_taxes_broker',
  coPropertyTaxes_others: 'origination_fees.1004_co_property_taxes_others',
  coPropertyTaxes_apr: 'origination_fees.1004_co_property_taxes_apr',
  coPropertyTaxes_paid_to_company: 'origination_fees.1004_co_property_taxes_paid_to_company',
  coPropertyTaxes_oral_disclosure: 'origination_fees.1004_co_property_taxes_oral_disclosure',

  customItem1000_label: 'origination_fees.1000_custom_item_label',
  customItem1000_payable_to: 'origination_fees.1000_custom_item_payable_to',
  customItem1000_d: 'origination_fees.1000_custom_item_d',
  customItem1000_charge: 'origination_fees.1000_custom_item_charge',
  customItem1000_broker: 'origination_fees.1000_custom_item_broker',
  customItem1000_others: 'origination_fees.1000_custom_item_others',
  customItem1000_apr: 'origination_fees.1000_custom_item_apr',
  customItem1000_paid_to_company: 'origination_fees.1000_custom_item_paid_to_company',
  customItem1000_oral_disclosure: 'origination_fees.1000_custom_item_oral_disclosure',

  // 1100 Title Charges
  settlementClosingFee_payable_to: 'origination_fees.1101_settlement_closing_fee_payable_to',
  settlementClosingFee_d: 'origination_fees.1101_settlement_closing_fee_d',
  settlementClosingFee_charge: 'origination_fees.1101_settlement_closing_fee_charge',
  settlementClosingFee_broker: 'origination_fees.1101_settlement_closing_fee_broker',
  settlementClosingFee_others: 'origination_fees.1101_settlement_closing_fee_others',
  settlementClosingFee_apr: 'origination_fees.1101_settlement_closing_fee_apr',
  settlementClosingFee_paid_to_company: 'origination_fees.1101_settlement_closing_fee_paid_to_company',
  settlementClosingFee_oral_disclosure: 'origination_fees.1101_settlement_closing_fee_oral_disclosure',

  docPreparationFee_payable_to: 'origination_fees.1105_doc_preparation_fee_payable_to',
  docPreparationFee_d: 'origination_fees.1105_doc_preparation_fee_d',
  docPreparationFee_charge: 'origination_fees.1105_doc_preparation_fee_charge',
  docPreparationFee_broker: 'origination_fees.1105_doc_preparation_fee_broker',
  docPreparationFee_others: 'origination_fees.1105_doc_preparation_fee_others',
  docPreparationFee_apr: 'origination_fees.1105_doc_preparation_fee_apr',
  docPreparationFee_paid_to_company: 'origination_fees.1105_doc_preparation_fee_paid_to_company',
  docPreparationFee_oral_disclosure: 'origination_fees.1105_doc_preparation_fee_oral_disclosure',

  notaryFee_payable_to: 'origination_fees.1106_notary_fee_payable_to',
  notaryFee_d: 'origination_fees.1106_notary_fee_d',
  notaryFee_charge: 'origination_fees.1106_notary_fee_charge',
  notaryFee_broker: 'origination_fees.1106_notary_fee_broker',
  notaryFee_others: 'origination_fees.1106_notary_fee_others',
  notaryFee_apr: 'origination_fees.1106_notary_fee_apr',
  notaryFee_paid_to_company: 'origination_fees.1106_notary_fee_paid_to_company',
  notaryFee_oral_disclosure: 'origination_fees.1106_notary_fee_oral_disclosure',

  titleInsurance_payable_to: 'origination_fees.1108_title_insurance_payable_to',
  titleInsurance_d: 'origination_fees.1108_title_insurance_d',
  titleInsurance_charge: 'origination_fees.1108_title_insurance_charge',
  titleInsurance_broker: 'origination_fees.1108_title_insurance_broker',
  titleInsurance_others: 'origination_fees.1108_title_insurance_others',
  titleInsurance_apr: 'origination_fees.1108_title_insurance_apr',
  titleInsurance_paid_to_company: 'origination_fees.1108_title_insurance_paid_to_company',
  titleInsurance_oral_disclosure: 'origination_fees.1108_title_insurance_oral_disclosure',

  customItem1100_label: 'origination_fees.1100_custom_item_label',
  customItem1100_payable_to: 'origination_fees.1100_custom_item_payable_to',
  customItem1100_d: 'origination_fees.1100_custom_item_d',
  customItem1100_charge: 'origination_fees.1100_custom_item_charge',
  customItem1100_broker: 'origination_fees.1100_custom_item_broker',
  customItem1100_others: 'origination_fees.1100_custom_item_others',
  customItem1100_apr: 'origination_fees.1100_custom_item_apr',
  customItem1100_paid_to_company: 'origination_fees.1100_custom_item_paid_to_company',
  customItem1100_oral_disclosure: 'origination_fees.1100_custom_item_oral_disclosure',

  // 1200 Government Recording and Transfer Charges
  recordingFees_payable_to: 'origination_fees.1201_recording_fees_payable_to',
  recordingFees_d: 'origination_fees.1201_recording_fees_d',
  recordingFees_charge: 'origination_fees.1201_recording_fees_charge',
  recordingFees_broker: 'origination_fees.1201_recording_fees_broker',
  recordingFees_others: 'origination_fees.1201_recording_fees_others',
  recordingFees_apr: 'origination_fees.1201_recording_fees_apr',
  recordingFees_paid_to_company: 'origination_fees.1201_recording_fees_paid_to_company',
  recordingFees_oral_disclosure: 'origination_fees.1201_recording_fees_oral_disclosure',

  // 1301 Add this line
  addThisLine_label: 'origination_fees.1301_add_this_line_label',
  addThisLine_payable_to: 'origination_fees.1301_add_this_line_payable_to',
  addThisLine_d: 'origination_fees.1301_add_this_line_d',
  addThisLine_charge: 'origination_fees.1301_add_this_line_charge',
  addThisLine_broker: 'origination_fees.1301_add_this_line_broker',
  addThisLine_others: 'origination_fees.1301_add_this_line_others',
  addThisLine_apr: 'origination_fees.1301_add_this_line_apr',
  addThisLine_paid_to_company: 'origination_fees.1301_add_this_line_paid_to_company',
  addThisLine_oral_disclosure: 'origination_fees.1301_add_this_line_oral_disclosure',

  cityCountyTaxStamps_payable_to: 'origination_fees.1202_city_county_tax_stamps_payable_to',
  cityCountyTaxStamps_d: 'origination_fees.1202_city_county_tax_stamps_d',
  cityCountyTaxStamps_charge: 'origination_fees.1202_city_county_tax_stamps_charge',
  cityCountyTaxStamps_broker: 'origination_fees.1202_city_county_tax_stamps_broker',
  cityCountyTaxStamps_others: 'origination_fees.1202_city_county_tax_stamps_others',
  cityCountyTaxStamps_apr: 'origination_fees.1202_city_county_tax_stamps_apr',
  cityCountyTaxStamps_paid_to_company: 'origination_fees.1202_city_county_tax_stamps_paid_to_company',
  cityCountyTaxStamps_oral_disclosure: 'origination_fees.1202_city_county_tax_stamps_oral_disclosure',

  customItem1200_label: 'origination_fees.1200_custom_item_label',
  customItem1200_payable_to: 'origination_fees.1200_custom_item_payable_to',
  customItem1200_d: 'origination_fees.1200_custom_item_d',
  customItem1200_charge: 'origination_fees.1200_custom_item_charge',
  customItem1200_broker: 'origination_fees.1200_custom_item_broker',
  customItem1200_others: 'origination_fees.1200_custom_item_others',
  customItem1200_apr: 'origination_fees.1200_custom_item_apr',
  customItem1200_paid_to_company: 'origination_fees.1200_custom_item_paid_to_company',
  customItem1200_oral_disclosure: 'origination_fees.1200_custom_item_oral_disclosure',

  // 1300 Additional Settlement Charges
  pestInspection_payable_to: 'origination_fees.1302_pest_inspection_payable_to',
  pestInspection_d: 'origination_fees.1302_pest_inspection_d',
  pestInspection_charge: 'origination_fees.1302_pest_inspection_charge',
  pestInspection_broker: 'origination_fees.1302_pest_inspection_broker',
  pestInspection_others: 'origination_fees.1302_pest_inspection_others',
  pestInspection_apr: 'origination_fees.1302_pest_inspection_apr',
  pestInspection_paid_to_company: 'origination_fees.1302_pest_inspection_paid_to_company',
  pestInspection_oral_disclosure: 'origination_fees.1302_pest_inspection_oral_disclosure',

  // Custom rows for 1300
  customItem1300_1_label: 'origination_fees.1300_custom_item_1_label',
  customItem1300_1_payable_to: 'origination_fees.1300_custom_item_1_payable_to',
  customItem1300_1_d: 'origination_fees.1300_custom_item_1_d',
  customItem1300_1_charge: 'origination_fees.1300_custom_item_1_charge',
  customItem1300_1_broker: 'origination_fees.1300_custom_item_1_broker',
  customItem1300_1_others: 'origination_fees.1300_custom_item_1_others',
  customItem1300_1_apr: 'origination_fees.1300_custom_item_1_apr',
  customItem1300_1_paid_to_company: 'origination_fees.1300_custom_item_1_paid_to_company',
  customItem1300_1_oral_disclosure: 'origination_fees.1300_custom_item_1_oral_disclosure',

  customItem1300_2_label: 'origination_fees.1300_custom_item_2_label',
  customItem1300_2_payable_to: 'origination_fees.1300_custom_item_2_payable_to',
  customItem1300_2_d: 'origination_fees.1300_custom_item_2_d',
  customItem1300_2_charge: 'origination_fees.1300_custom_item_2_charge',
  customItem1300_2_broker: 'origination_fees.1300_custom_item_2_broker',
  customItem1300_2_others: 'origination_fees.1300_custom_item_2_others',
  customItem1300_2_apr: 'origination_fees.1300_custom_item_2_apr',
  customItem1300_2_paid_to_company: 'origination_fees.1300_custom_item_2_paid_to_company',
  customItem1300_2_oral_disclosure: 'origination_fees.1300_custom_item_2_oral_disclosure',

  customItem1300_3_label: 'origination_fees.1300_custom_item_3_label',
  customItem1300_3_payable_to: 'origination_fees.1300_custom_item_3_payable_to',
  customItem1300_3_d: 'origination_fees.1300_custom_item_3_d',
  customItem1300_3_charge: 'origination_fees.1300_custom_item_3_charge',
  customItem1300_3_broker: 'origination_fees.1300_custom_item_3_broker',
  customItem1300_3_others: 'origination_fees.1300_custom_item_3_others',
  customItem1300_3_apr: 'origination_fees.1300_custom_item_3_apr',
  customItem1300_3_paid_to_company: 'origination_fees.1300_custom_item_3_paid_to_company',
  customItem1300_3_oral_disclosure: 'origination_fees.1300_custom_item_3_oral_disclosure',

  customItem1300_4_label: 'origination_fees.1300_custom_item_4_label',
  customItem1300_4_payable_to: 'origination_fees.1300_custom_item_4_payable_to',
  customItem1300_4_d: 'origination_fees.1300_custom_item_4_d',
  customItem1300_4_charge: 'origination_fees.1300_custom_item_4_charge',
  customItem1300_4_broker: 'origination_fees.1300_custom_item_4_broker',
  customItem1300_4_others: 'origination_fees.1300_custom_item_4_others',
  customItem1300_4_apr: 'origination_fees.1300_custom_item_4_apr',
  customItem1300_4_paid_to_company: 'origination_fees.1300_custom_item_4_paid_to_company',
  customItem1300_4_oral_disclosure: 'origination_fees.1300_custom_item_4_oral_disclosure',

  customItem1300_5_label: 'origination_fees.1300_custom_item_5_label',
  customItem1300_5_payable_to: 'origination_fees.1300_custom_item_5_payable_to',
  customItem1300_5_d: 'origination_fees.1300_custom_item_5_d',
  customItem1300_5_charge: 'origination_fees.1300_custom_item_5_charge',
  customItem1300_5_broker: 'origination_fees.1300_custom_item_5_broker',
  customItem1300_5_others: 'origination_fees.1300_custom_item_5_others',
  customItem1300_5_apr: 'origination_fees.1300_custom_item_5_apr',
  customItem1300_5_paid_to_company: 'origination_fees.1300_custom_item_5_paid_to_company',
  customItem1300_5_oral_disclosure: 'origination_fees.1300_custom_item_5_oral_disclosure',

  customItem1300_6_label: 'origination_fees.1300_custom_item_6_label',
  customItem1300_6_payable_to: 'origination_fees.1300_custom_item_6_payable_to',
  customItem1300_6_d: 'origination_fees.1300_custom_item_6_d',
  customItem1300_6_charge: 'origination_fees.1300_custom_item_6_charge',
  customItem1300_6_broker: 'origination_fees.1300_custom_item_6_broker',
  customItem1300_6_others: 'origination_fees.1300_custom_item_6_others',
  customItem1300_6_apr: 'origination_fees.1300_custom_item_6_apr',
  customItem1300_6_paid_to_company: 'origination_fees.1300_custom_item_6_paid_to_company',
  customItem1300_6_oral_disclosure: 'origination_fees.1300_custom_item_6_oral_disclosure',

  customItem1300_7_label: 'origination_fees.1300_custom_item_7_label',
  customItem1300_7_payable_to: 'origination_fees.1300_custom_item_7_payable_to',
  customItem1300_7_d: 'origination_fees.1300_custom_item_7_d',
  customItem1300_7_charge: 'origination_fees.1300_custom_item_7_charge',
  customItem1300_7_broker: 'origination_fees.1300_custom_item_7_broker',
  customItem1300_7_others: 'origination_fees.1300_custom_item_7_others',
  customItem1300_7_apr: 'origination_fees.1300_custom_item_7_apr',
  customItem1300_7_paid_to_company: 'origination_fees.1300_custom_item_7_paid_to_company',
  customItem1300_7_oral_disclosure: 'origination_fees.1300_custom_item_7_oral_disclosure',

  customItem1300_8_label: 'origination_fees.1300_custom_item_8_label',
  customItem1300_8_payable_to: 'origination_fees.1300_custom_item_8_payable_to',
  customItem1300_8_d: 'origination_fees.1300_custom_item_8_d',
  customItem1300_8_charge: 'origination_fees.1300_custom_item_8_charge',
  customItem1300_8_broker: 'origination_fees.1300_custom_item_8_broker',
  customItem1300_8_others: 'origination_fees.1300_custom_item_8_others',
  customItem1300_8_apr: 'origination_fees.1300_custom_item_8_apr',
  customItem1300_8_paid_to_company: 'origination_fees.1300_custom_item_8_paid_to_company',
  customItem1300_8_oral_disclosure: 'origination_fees.1300_custom_item_8_oral_disclosure',

  // 901 dynamic description fields
  interestForDays_days: 'origination_fees.901_interest_for_days_days',
  interestForDays_perDay: 'origination_fees.901_interest_for_days_per_day',

  // Subtotal and Total
  subtotal_j: 'origination_fees.subtotal_j',
  subtotal_others: 'origination_fees.subtotal_others',
  total_j: 'origination_fees.total_j',

  // Compensation to Broker
  commissionFees_d: 'origination_fees.commission_fees_d',
  additionalCompensation_d: 'origination_fees.additional_compensation_d',

  // Payment of Other Obligations
  creditLifeDisabilityInsurance_label: 'origination_fees.credit_life_disability_insurance_label',
  loanDocumentationFee_d: 'origination_fees.loan_documentation_fee_d',
  customOtherObligation_label: 'origination_fees.custom_other_obligation_label',
  customOtherObligation_d: 'origination_fees.custom_other_obligation_d',

  // Payment to Existing Liens
  existingLien1_label: 'origination_fees.existing_lien_1_label',
  existingLien1_d: 'origination_fees.existing_lien_1_d',
  existingLien2_label: 'origination_fees.existing_lien_2_label',
  existingLien2_d: 'origination_fees.existing_lien_2_d',
  existingLien3_label: 'origination_fees.existing_lien_3_label',
  existingLien3_d: 'origination_fees.existing_lien_3_d',

  // RE 885 Proposed Loan Terms (Sections I–IX)
  re885_proposed_loan_amount: 'origination_fees.re885_proposed_loan_amount',
  re885_initial_fees_page1: 'origination_fees.re885_initial_fees_page1',
  re885_other_obligations: 'origination_fees.re885_other_obligations',
  re885_credit_life_insurance: 'origination_fees.re885_credit_life_insurance',
  re885_additional_obligation_1: 'origination_fees.re885_additional_obligation_1',
  re885_additional_obligation_2: 'origination_fees.re885_additional_obligation_2',
  re885_subtotal_deductions: 'origination_fees.re885_subtotal_deductions',
  re885_cash_at_closing_option: 'origination_fees.re885_cash_at_closing_option',
  re885_cash_at_closing_amount: 'origination_fees.re885_cash_at_closing_amount',
  re885_loan_term_value: 'origination_fees.re885_loan_term_value',
  re885_loan_term_unit: 'origination_fees.re885_loan_term_unit',
  re885_interest_rate: 'origination_fees.re885_interest_rate',
  re885_rate_type_fixed: 'origination_fees.re885_rate_type_fixed',
  re885_rate_type_adjustable: 'origination_fees.re885_rate_type_adjustable',
  re885_iv_adj_rate_months: 'origination_fees.re885_iv_adj_rate_months',
  re885_v_fully_indexed_rate: 'origination_fees.re885_v_fully_indexed_rate',
  re885_vi_max_interest_rate: 'origination_fees.re885_vi_max_interest_rate',
  re885_vii_payment_amount: 'origination_fees.re885_vii_payment_amount',
  re885_viii_rate_increase_pct: 'origination_fees.re885_viii_rate_increase_pct',
  re885_viii_rate_increase_months: 'origination_fees.re885_viii_rate_increase_months',
  re885_ix_payment_end_months: 'origination_fees.re885_ix_payment_end_months',
  re885_ix_payment_end_pct: 'origination_fees.re885_ix_payment_end_pct',

  // Custom fillable rows (2 per section) for HUD-1 sections 800, 900, 1100
  hud800_custom1_description: 'origination_fees.800_custom1_description',
  hud800_custom1_others: 'origination_fees.800_custom1_others',
  hud800_custom1_broker: 'origination_fees.800_custom1_broker',
  hud800_custom1_apr: 'origination_fees.800_custom1_apr',
  hud800_custom1_paid_to_company: 'origination_fees.800_custom1_paid_to_company',
  hud800_custom2_description: 'origination_fees.800_custom2_description',
  hud800_custom2_others: 'origination_fees.800_custom2_others',
  hud800_custom2_broker: 'origination_fees.800_custom2_broker',
  hud800_custom2_apr: 'origination_fees.800_custom2_apr',
  hud800_custom2_paid_to_company: 'origination_fees.800_custom2_paid_to_company',

  hud900_custom1_description: 'origination_fees.900_custom1_description',
  hud900_custom1_others: 'origination_fees.900_custom1_others',
  hud900_custom1_broker: 'origination_fees.900_custom1_broker',
  hud900_custom1_apr: 'origination_fees.900_custom1_apr',
  hud900_custom1_paid_to_company: 'origination_fees.900_custom1_paid_to_company',
  hud900_custom2_description: 'origination_fees.900_custom2_description',
  hud900_custom2_others: 'origination_fees.900_custom2_others',
  hud900_custom2_broker: 'origination_fees.900_custom2_broker',
  hud900_custom2_apr: 'origination_fees.900_custom2_apr',
  hud900_custom2_paid_to_company: 'origination_fees.900_custom2_paid_to_company',

  hud1100_custom1_description: 'origination_fees.1100_custom1_description',
  hud1100_custom1_others: 'origination_fees.1100_custom1_others',
  hud1100_custom1_broker: 'origination_fees.1100_custom1_broker',
  hud1100_custom1_apr: 'origination_fees.1100_custom1_apr',
  hud1100_custom1_paid_to_company: 'origination_fees.1100_custom1_paid_to_company',
  hud1100_custom2_description: 'origination_fees.1100_custom2_description',
  hud1100_custom2_others: 'origination_fees.1100_custom2_others',
  hud1100_custom2_broker: 'origination_fees.1100_custom2_broker',
  hud1100_custom2_apr: 'origination_fees.1100_custom2_apr',
  hud1100_custom2_paid_to_company: 'origination_fees.1100_custom2_paid_to_company',
};

const GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '55px minmax(160px, 1fr) minmax(120px, 1fr) 110px 110px 70px 70px',
  gap: '4px',
  alignItems: 'center',
};

export const OriginationFeesForm: React.FC<OriginationFeesFormProps> = ({
  values,
  onValueChange,
  disabled = false,
}) => {
  const getValue = (key: string) => values[key] || '';
  const setValue = (key: string, value: string) => onValueChange(key, value);
  const getBoolValue = (key: string) => values[key] === 'true';
  const setBoolValue = (key: string, value: boolean) => onValueChange(key, String(value));

  const parseNumber = (val: string): number => {
    if (!val) return 0;
    const num = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
    return isNaN(num) ? 0 : num;
  };

  // Calculate insurance totals for 1000 section
  useEffect(() => {
    const m = parseNumber(getValue(FIELD_KEYS.hazardInsurance_months));
    const p = parseNumber(getValue(FIELD_KEYS.hazardInsurance_perMonth));
    if (m * p > 0) setValue(FIELD_KEYS.hazardInsurance_total, (m * p).toFixed(2));
  }, [values[FIELD_KEYS.hazardInsurance_months], values[FIELD_KEYS.hazardInsurance_perMonth]]);

  useEffect(() => {
    const m = parseNumber(getValue(FIELD_KEYS.mortgageInsurance_months));
    const p = parseNumber(getValue(FIELD_KEYS.mortgageInsurance_perMonth));
    if (m * p > 0) setValue(FIELD_KEYS.mortgageInsurance_total, (m * p).toFixed(2));
  }, [values[FIELD_KEYS.mortgageInsurance_months], values[FIELD_KEYS.mortgageInsurance_perMonth]]);

  useEffect(() => {
    const m = parseNumber(getValue(FIELD_KEYS.coPropertyTaxes_months));
    const p = parseNumber(getValue(FIELD_KEYS.coPropertyTaxes_perMonth));
    if (m * p > 0) setValue(FIELD_KEYS.coPropertyTaxes_total, (m * p).toFixed(2));
  }, [values[FIELD_KEYS.coPropertyTaxes_months], values[FIELD_KEYS.coPropertyTaxes_perMonth]]);

  // ─── Upstream loan values (read from Loan tab)
  const loanAmountUpstream = parseNumber(values['loan_terms.loan_amount'] || values['loan_terms.original_amount'] || '');
  const loanRateUpstream = parseNumber(values['loan_terms.note_rate'] || values['loan_terms.current_rate'] || '');

  // ─── 901 Prepaid Interest: per-day = loan_amount × (rate/100/365); row total = days × per-day
  const perDayAuto = loanAmountUpstream > 0 && loanRateUpstream > 0
    ? (loanAmountUpstream * (loanRateUpstream / 100) / 365)
    : 0;

  useEffect(() => {
    if (perDayAuto > 0) {
      const formatted = formatCurrencyDisplay(perDayAuto.toFixed(2));
      if (getValue(FIELD_KEYS.interestForDays_perDay) !== formatted) {
        setValue(FIELD_KEYS.interestForDays_perDay, formatted);
      }
    }
  }, [perDayAuto]);

  useEffect(() => {
    const days = parseNumber(getValue(FIELD_KEYS.interestForDays_days));
    if (days > 0 && perDayAuto > 0) {
      const total = days * perDayAuto;
      const formatted = formatCurrencyDisplay(total.toFixed(2));
      if (getValue(FIELD_KEYS.interestForDays_others) !== formatted) {
        setValue(FIELD_KEYS.interestForDays_others, formatted);
      }
    }
  }, [perDayAuto, values[FIELD_KEYS.interestForDays_days]]);

  // ─── Section subtotals + Grand Total (Paid to Others + Paid to Broker across all rows)
  const sumRowKeys = (rows: { others: string; broker: string }[]) =>
    rows.reduce((acc, r) => acc + parseNumber(getValue(r.others)) + parseNumber(getValue(r.broker)), 0);

  const section800Rows = [
    { others: FIELD_KEYS.lendersLoanOriginationFee_others, broker: FIELD_KEYS.lendersLoanOriginationFee_broker },
    { others: FIELD_KEYS.lendersLoanDiscountFee_others, broker: FIELD_KEYS.lendersLoanDiscountFee_broker },
    { others: FIELD_KEYS.appraisalFee_others, broker: FIELD_KEYS.appraisalFee_broker },
    { others: FIELD_KEYS.creditReport_others, broker: FIELD_KEYS.creditReport_broker },
    { others: FIELD_KEYS.lendersInspectionFee_others, broker: FIELD_KEYS.lendersInspectionFee_broker },
    { others: FIELD_KEYS.mortgageBrokerFee_others, broker: FIELD_KEYS.mortgageBrokerFee_broker },
    { others: FIELD_KEYS.taxServiceFee_others, broker: FIELD_KEYS.taxServiceFee_broker },
    { others: FIELD_KEYS.processingFee_others, broker: FIELD_KEYS.processingFee_broker },
    { others: FIELD_KEYS.underwritingFee_others, broker: FIELD_KEYS.underwritingFee_broker },
    { others: FIELD_KEYS.wireTransferFee_others, broker: FIELD_KEYS.wireTransferFee_broker },
    { others: FIELD_KEYS.hud800_custom1_others, broker: FIELD_KEYS.hud800_custom1_broker },
    { others: FIELD_KEYS.hud800_custom2_others, broker: FIELD_KEYS.hud800_custom2_broker },
  ];
  const section900Rows = [
    { others: FIELD_KEYS.interestForDays_others, broker: FIELD_KEYS.interestForDays_broker },
    { others: FIELD_KEYS.mortgageInsurancePremiums_others, broker: FIELD_KEYS.mortgageInsurancePremiums_broker },
    { others: FIELD_KEYS.hazardInsurancePremiums_others, broker: FIELD_KEYS.hazardInsurancePremiums_broker },
    { others: FIELD_KEYS.countyPropertyTaxes_others, broker: FIELD_KEYS.countyPropertyTaxes_broker },
    { others: FIELD_KEYS.vaFundingFee_others, broker: FIELD_KEYS.vaFundingFee_broker },
    { others: FIELD_KEYS.hud900_custom1_others, broker: FIELD_KEYS.hud900_custom1_broker },
    { others: FIELD_KEYS.hud900_custom2_others, broker: FIELD_KEYS.hud900_custom2_broker },
  ];
  const section1000Rows = [
    { others: FIELD_KEYS.hazardInsurance_others, broker: FIELD_KEYS.hazardInsurance_broker },
    { others: FIELD_KEYS.mortgageInsurance_others, broker: FIELD_KEYS.mortgageInsurance_broker },
    { others: FIELD_KEYS.coPropertyTaxes_others, broker: FIELD_KEYS.coPropertyTaxes_broker },
  ];
  const section1100Rows = [
    { others: FIELD_KEYS.settlementClosingFee_others, broker: FIELD_KEYS.settlementClosingFee_broker },
    { others: FIELD_KEYS.docPreparationFee_others, broker: FIELD_KEYS.docPreparationFee_broker },
    { others: FIELD_KEYS.notaryFee_others, broker: FIELD_KEYS.notaryFee_broker },
    { others: FIELD_KEYS.titleInsurance_others, broker: FIELD_KEYS.titleInsurance_broker },
    { others: FIELD_KEYS.hud1100_custom1_others, broker: FIELD_KEYS.hud1100_custom1_broker },
    { others: FIELD_KEYS.hud1100_custom2_others, broker: FIELD_KEYS.hud1100_custom2_broker },
  ];
  const section1200Rows = [
    { others: FIELD_KEYS.recordingFees_others, broker: FIELD_KEYS.recordingFees_broker },
    { others: FIELD_KEYS.cityCountyTaxStamps_others, broker: FIELD_KEYS.cityCountyTaxStamps_broker },
  ];
  const section1300Rows = [
    { others: FIELD_KEYS.pestInspection_others, broker: FIELD_KEYS.pestInspection_broker },
  ];

  const section800Total = sumRowKeys(section800Rows);
  const section900Total = sumRowKeys(section900Rows);
  const section1000Total = sumRowKeys(section1000Rows);
  const section1100Total = sumRowKeys(section1100Rows);
  const section1200Total = sumRowKeys(section1200Rows);
  const section1300Total = sumRowKeys(section1300Rows);
  const grandTotal = section800Total + section900Total + section1000Total + section1100Total + section1200Total + section1300Total;

  // Persist computed subtotal/total so document merge-tags resolve
  useEffect(() => {
    const f = formatCurrencyDisplay(grandTotal.toFixed(2));
    if (getValue(FIELD_KEYS.subtotal_j) !== f) setValue(FIELD_KEYS.subtotal_j, f);
    if (getValue(FIELD_KEYS.total_j) !== f) setValue(FIELD_KEYS.total_j, f);
  }, [grandTotal]);

  // ─── Auto-fill Payment to Existing Liens from Properties tab
  useEffect(() => {
    const lienSlots = [
      { labelKey: FIELD_KEYS.existingLien1_label, amtKey: FIELD_KEYS.existingLien1_d },
      { labelKey: FIELD_KEYS.existingLien2_label, amtKey: FIELD_KEYS.existingLien2_d },
      { labelKey: FIELD_KEYS.existingLien3_label, amtKey: FIELD_KEYS.existingLien3_d },
    ];
    const collected: { label: string; amount: number }[] = [];
    for (let p = 1; p <= 10 && collected.length < lienSlots.length; p++) {
      const holder = values[`property${p}.lien_holder`] || '';
      const balance = parseNumber(values[`property${p}.lien_current_balance`] || values[`property${p}.lien_original_balance`] || '');
      if (holder || balance > 0) {
        collected.push({ label: holder || `Property ${p} Lien`, amount: balance });
      }
    }
    lienSlots.forEach((slot, i) => {
      const entry = collected[i];
      const lbl = entry ? entry.label : '';
      const amt = entry && entry.amount > 0 ? formatCurrencyDisplay(entry.amount.toFixed(2)) : '';
      if (getValue(slot.labelKey) !== lbl) setValue(slot.labelKey, lbl);
      if (getValue(slot.amtKey) !== amt) setValue(slot.amtKey, amt);
    });
  }, [
    values['property1.lien_holder'], values['property1.lien_current_balance'], values['property1.lien_original_balance'],
    values['property2.lien_holder'], values['property2.lien_current_balance'], values['property2.lien_original_balance'],
    values['property3.lien_holder'], values['property3.lien_current_balance'], values['property3.lien_original_balance'],
  ]);

  const liensPayoffTotal = parseNumber(getValue(FIELD_KEYS.existingLien1_d))
    + parseNumber(getValue(FIELD_KEYS.existingLien2_d))
    + parseNumber(getValue(FIELD_KEYS.existingLien3_d));

  // Standard fee row: HUD# | Description | Comment | Paid to Others | Paid to Broker | Include in APR | Paid to Company
  const renderFeeRow = (
    hudNumber: string,
    description: string,
    keys: {
      others: string;
      broker: string;
      apr: string;
      paidToCompany: string;
    },
    labelKey?: string,
    descriptionNode?: React.ReactNode,
    commentKey?: string
  ) => {
    return (
      <DirtyFieldWrapper fieldKey={keys.others}>
        <div style={GRID_STYLE} className="py-1 border-b border-border/50">
          <div className="text-xs font-medium text-foreground">{hudNumber}</div>
          {labelKey ? (
            <Input value={getValue(labelKey)} onChange={(e) => setValue(labelKey, e.target.value)} disabled={disabled} placeholder="Enter description" className="h-7 text-xs" />
          ) : descriptionNode ? (
            <div className="text-xs text-foreground">{descriptionNode}</div>
          ) : (
            <div className="text-xs text-foreground">{description}</div>
          )}
          {commentKey ? (
            <Input value={getValue(commentKey)} onChange={(e) => setValue(commentKey, e.target.value)} disabled={disabled} placeholder="Enter Description" className="h-7 text-xs" />
          ) : <div />}
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">$</span>
            <Input inputMode="decimal" value={getValue(keys.others)} onChange={(e) => setValue(keys.others, unformatCurrencyDisplay(e.target.value))} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (val) => setValue(keys.others, val))} onBlur={() => { const raw = getValue(keys.others); if (raw) setValue(keys.others, formatCurrencyDisplay(raw)); }} onFocus={() => { const raw = getValue(keys.others); if (raw) setValue(keys.others, unformatCurrencyDisplay(raw)); }} disabled={disabled} placeholder="0.00" className="h-7 text-xs text-right pl-5" />
          </div>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">$</span>
            <Input inputMode="decimal" value={getValue(keys.broker)} onChange={(e) => setValue(keys.broker, unformatCurrencyDisplay(e.target.value))} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (val) => setValue(keys.broker, val))} onBlur={() => { const raw = getValue(keys.broker); if (raw) setValue(keys.broker, formatCurrencyDisplay(raw)); }} onFocus={() => { const raw = getValue(keys.broker); if (raw) setValue(keys.broker, unformatCurrencyDisplay(raw)); }} disabled={disabled} placeholder="0.00" className="h-7 text-xs text-right pl-5" />
          </div>
          <div className="flex justify-center"><Checkbox checked={getBoolValue(keys.apr)} onCheckedChange={(c) => setBoolValue(keys.apr, !!c)} disabled={disabled} /></div>
          <div className="flex justify-center"><Checkbox checked={getBoolValue(keys.paidToCompany)} onCheckedChange={(c) => setBoolValue(keys.paidToCompany, !!c)} disabled={disabled} /></div>
        </div>
      </DirtyFieldWrapper>
    );
  };

  // Insurance row for 1000 section with dynamic description
  const renderInsuranceRow = (
    hudNumber: string,
    baseName: string,
    monthsKey: string,
    perMonthKey: string,
    totalKey: string,
    keys: { others: string; broker: string; apr: string; paidToCompany: string },
    commentKey?: string
  ) => {
    const totalVal = getValue(totalKey);

    return (
      <DirtyFieldWrapper fieldKey={monthsKey}>
        <div style={GRID_STYLE} className="py-1 border-b border-border/50">
          <div className="text-xs font-medium text-foreground">{hudNumber}</div>
          <div className="flex items-center gap-1 text-xs text-foreground flex-wrap">
            <span>{baseName}:</span>
            <Input type="number" inputMode="numeric" value={getValue(monthsKey)} onChange={(e) => setValue(monthsKey, e.target.value)} disabled={disabled} placeholder="0" className="h-6 text-xs text-right w-12 inline-flex" />
            <span>months at $</span>
            <Input inputMode="decimal" value={getValue(perMonthKey)} onChange={(e) => setValue(perMonthKey, unformatCurrencyDisplay(e.target.value))} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (val) => setValue(perMonthKey, val))} onBlur={() => { const raw = getValue(perMonthKey); if (raw) setValue(perMonthKey, formatCurrencyDisplay(raw)); }} onFocus={() => { const raw = getValue(perMonthKey); if (raw) setValue(perMonthKey, unformatCurrencyDisplay(raw)); }} disabled={disabled} placeholder="0.00" className="h-6 text-xs text-right w-20 inline-flex" />
            <span>/mo</span>
            {totalVal && <span className="text-muted-foreground ml-1">= ${formatCurrencyDisplay(totalVal)}</span>}
          </div>
          {commentKey ? (
            <Input value={getValue(commentKey)} onChange={(e) => setValue(commentKey, e.target.value)} disabled={disabled} placeholder="Enter Description" className="h-7 text-xs" />
          ) : <div />}
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">$</span>
            <Input inputMode="decimal" value={getValue(keys.others)} onChange={(e) => setValue(keys.others, unformatCurrencyDisplay(e.target.value))} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (val) => setValue(keys.others, val))} onBlur={() => { const raw = getValue(keys.others); if (raw) setValue(keys.others, formatCurrencyDisplay(raw)); }} onFocus={() => { const raw = getValue(keys.others); if (raw) setValue(keys.others, unformatCurrencyDisplay(raw)); }} disabled={disabled} placeholder="0.00" className="h-7 text-xs text-right pl-5" />
          </div>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">$</span>
            <Input inputMode="decimal" value={getValue(keys.broker)} onChange={(e) => setValue(keys.broker, unformatCurrencyDisplay(e.target.value))} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (val) => setValue(keys.broker, val))} onBlur={() => { const raw = getValue(keys.broker); if (raw) setValue(keys.broker, formatCurrencyDisplay(raw)); }} onFocus={() => { const raw = getValue(keys.broker); if (raw) setValue(keys.broker, unformatCurrencyDisplay(raw)); }} disabled={disabled} placeholder="0.00" className="h-7 text-xs text-right pl-5" />
          </div>
          <div className="flex justify-center"><Checkbox checked={getBoolValue(keys.apr)} onCheckedChange={(c) => setBoolValue(keys.apr, !!c)} disabled={disabled} /></div>
          <div className="flex justify-center"><Checkbox checked={getBoolValue(keys.paidToCompany)} onCheckedChange={(c) => setBoolValue(keys.paidToCompany, !!c)} disabled={disabled} /></div>
        </div>
      </DirtyFieldWrapper>
    );
  };

  // Simple row for bottom sections (label + amount only)
  const renderSimpleRow = (label: string, dKey: string, labelKey?: string) => (
    <DirtyFieldWrapper fieldKey={dKey}>
      <div className="flex items-center gap-2 py-1 border-b border-border/50">
        {labelKey ? (
          <Input value={getValue(labelKey)} onChange={(e) => setValue(labelKey, e.target.value)} disabled={disabled} placeholder="Enter description" className="h-7 text-xs flex-1" />
        ) : (
          <div className="text-xs text-foreground flex-1">{label}</div>
        )}
        <div className="relative w-28">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">$</span>
          <Input inputMode="decimal" value={getValue(dKey)} onChange={(e) => setValue(dKey, unformatCurrencyDisplay(e.target.value))} onKeyDown={numericKeyDown} onPaste={(e) => numericPaste(e, (val) => setValue(dKey, val))} onBlur={() => { const raw = getValue(dKey); if (raw) setValue(dKey, formatCurrencyDisplay(raw)); }} onFocus={() => { const raw = getValue(dKey); if (raw) setValue(dKey, unformatCurrencyDisplay(raw)); }} disabled={disabled} placeholder="0.00" className="h-7 text-xs text-right pl-5" />
        </div>
      </div>
    </DirtyFieldWrapper>
  );

  // Dynamic description for 901 (per-day auto-computed, read-only)
  const render901Description = () => (
    <div className="flex items-center gap-1 text-xs text-foreground flex-wrap">
      <span>Interest for</span>
      <Input type="number" inputMode="numeric" value={getValue(FIELD_KEYS.interestForDays_days)} onChange={(e) => setValue(FIELD_KEYS.interestForDays_days, e.target.value)} disabled={disabled} placeholder="0" className="h-6 text-xs text-right w-12 inline-flex" />
      <span>days at $</span>
      <Input inputMode="decimal" value={getValue(FIELD_KEYS.interestForDays_perDay)} readOnly disabled placeholder="0.00" title="Auto: Loan Amount × (Interest Rate ÷ 365)" className="h-6 text-xs text-right w-20 inline-flex bg-muted/50" />
      <span>per day</span>
    </div>
  );


  return (
    <div className="p-4 space-y-6 overflow-x-auto">
      {/* Column headers */}
      <div style={GRID_STYLE} className="py-2 border-b-2 border-foreground text-xs font-semibold text-foreground">
        <div>HUD-1 #</div>
        <div>Item Description</div>
        <div></div>
        <div className="text-center">Paid to Others</div>
        <div className="text-center">Paid to Broker</div>
        <div className="text-center">Include in APR</div>
        <div className="text-center">Paid to Company</div>
      </div>

      {/* 800 Items Payable in Connection with Loan */}
      <div className="space-y-0">
        <h3 className="font-semibold text-sm text-foreground underline mb-1">800 – Items Payable in Connection with Loan</h3>
        {renderFeeRow('801', "Lender's Loan Origination Fee", { others: FIELD_KEYS.lendersLoanOriginationFee_others, broker: FIELD_KEYS.lendersLoanOriginationFee_broker, apr: FIELD_KEYS.lendersLoanOriginationFee_apr, paidToCompany: FIELD_KEYS.lendersLoanOriginationFee_paid_to_company }, undefined, undefined, FIELD_KEYS.lendersLoanOriginationFee_d)}
        {renderFeeRow('802', "Lender's Loan Discount Fee", { others: FIELD_KEYS.lendersLoanDiscountFee_others, broker: FIELD_KEYS.lendersLoanDiscountFee_broker, apr: FIELD_KEYS.lendersLoanDiscountFee_apr, paidToCompany: FIELD_KEYS.lendersLoanDiscountFee_paid_to_company }, undefined, undefined, FIELD_KEYS.lendersLoanDiscountFee_d)}
        {renderFeeRow('803', 'Appraisal Fee', { others: FIELD_KEYS.appraisalFee_others, broker: FIELD_KEYS.appraisalFee_broker, apr: FIELD_KEYS.appraisalFee_apr, paidToCompany: FIELD_KEYS.appraisalFee_paid_to_company }, undefined, undefined, FIELD_KEYS.appraisalFee_d)}
        {renderFeeRow('804', 'Credit Report', { others: FIELD_KEYS.creditReport_others, broker: FIELD_KEYS.creditReport_broker, apr: FIELD_KEYS.creditReport_apr, paidToCompany: FIELD_KEYS.creditReport_paid_to_company }, undefined, undefined, FIELD_KEYS.creditReport_d)}
        {renderFeeRow('805', "Lender's Inspection Fee", { others: FIELD_KEYS.lendersInspectionFee_others, broker: FIELD_KEYS.lendersInspectionFee_broker, apr: FIELD_KEYS.lendersInspectionFee_apr, paidToCompany: FIELD_KEYS.lendersInspectionFee_paid_to_company }, undefined, undefined, FIELD_KEYS.lendersInspectionFee_d)}
        {renderFeeRow('806', 'Mortgage Broker Commission/Fee', { others: FIELD_KEYS.mortgageBrokerFee_others, broker: FIELD_KEYS.mortgageBrokerFee_broker, apr: FIELD_KEYS.mortgageBrokerFee_apr, paidToCompany: FIELD_KEYS.mortgageBrokerFee_paid_to_company }, undefined, undefined, FIELD_KEYS.mortgageBrokerFee_d)}
        {renderFeeRow('809', 'Tax Service Fee', { others: FIELD_KEYS.taxServiceFee_others, broker: FIELD_KEYS.taxServiceFee_broker, apr: FIELD_KEYS.taxServiceFee_apr, paidToCompany: FIELD_KEYS.taxServiceFee_paid_to_company }, undefined, undefined, FIELD_KEYS.taxServiceFee_d)}
        {renderFeeRow('810', 'Processing Fee', { others: FIELD_KEYS.processingFee_others, broker: FIELD_KEYS.processingFee_broker, apr: FIELD_KEYS.processingFee_apr, paidToCompany: FIELD_KEYS.processingFee_paid_to_company }, undefined, undefined, FIELD_KEYS.processingFee_d)}
        {renderFeeRow('811', 'Underwriting Fee', { others: FIELD_KEYS.underwritingFee_others, broker: FIELD_KEYS.underwritingFee_broker, apr: FIELD_KEYS.underwritingFee_apr, paidToCompany: FIELD_KEYS.underwritingFee_paid_to_company }, undefined, undefined, FIELD_KEYS.underwritingFee_d)}
        {renderFeeRow('812', 'Wire Transfer Fee', { others: FIELD_KEYS.wireTransferFee_others, broker: FIELD_KEYS.wireTransferFee_broker, apr: FIELD_KEYS.wireTransferFee_apr, paidToCompany: FIELD_KEYS.wireTransferFee_paid_to_company }, undefined, undefined, FIELD_KEYS.wireTransferFee_d)}
        {renderFeeRow('', '', { others: FIELD_KEYS.hud800_custom1_others, broker: FIELD_KEYS.hud800_custom1_broker, apr: FIELD_KEYS.hud800_custom1_apr, paidToCompany: FIELD_KEYS.hud800_custom1_paid_to_company }, undefined, undefined, FIELD_KEYS.hud800_custom1_description)}
        {renderFeeRow('', '', { others: FIELD_KEYS.hud800_custom2_others, broker: FIELD_KEYS.hud800_custom2_broker, apr: FIELD_KEYS.hud800_custom2_apr, paidToCompany: FIELD_KEYS.hud800_custom2_paid_to_company }, undefined, undefined, FIELD_KEYS.hud800_custom2_description)}
      </div>

      {/* 900 Items Required by Lender to be Paid in Advance */}
      <div className="space-y-0">
        <h3 className="font-semibold text-sm text-foreground underline mb-1">900 – Items Required by Lender to be Paid in Advance</h3>
        {renderFeeRow('901', '', { others: FIELD_KEYS.interestForDays_others, broker: FIELD_KEYS.interestForDays_broker, apr: FIELD_KEYS.interestForDays_apr, paidToCompany: FIELD_KEYS.interestForDays_paid_to_company }, undefined, render901Description(), FIELD_KEYS.interestForDays_d)}
        {renderFeeRow('902', 'Mortgage Insurance Premiums', { others: FIELD_KEYS.mortgageInsurancePremiums_others, broker: FIELD_KEYS.mortgageInsurancePremiums_broker, apr: FIELD_KEYS.mortgageInsurancePremiums_apr, paidToCompany: FIELD_KEYS.mortgageInsurancePremiums_paid_to_company }, undefined, undefined, FIELD_KEYS.mortgageInsurancePremiums_d)}
        {renderFeeRow('903', 'Hazard Insurance Premiums', { others: FIELD_KEYS.hazardInsurancePremiums_others, broker: FIELD_KEYS.hazardInsurancePremiums_broker, apr: FIELD_KEYS.hazardInsurancePremiums_apr, paidToCompany: FIELD_KEYS.hazardInsurancePremiums_paid_to_company }, undefined, undefined, FIELD_KEYS.hazardInsurancePremiums_d)}
        {renderFeeRow('904', 'County Property Taxes', { others: FIELD_KEYS.countyPropertyTaxes_others, broker: FIELD_KEYS.countyPropertyTaxes_broker, apr: FIELD_KEYS.countyPropertyTaxes_apr, paidToCompany: FIELD_KEYS.countyPropertyTaxes_paid_to_company }, undefined, undefined, FIELD_KEYS.countyPropertyTaxes_d)}
        {renderFeeRow('905', 'VA Funding Fee', { others: FIELD_KEYS.vaFundingFee_others, broker: FIELD_KEYS.vaFundingFee_broker, apr: FIELD_KEYS.vaFundingFee_apr, paidToCompany: FIELD_KEYS.vaFundingFee_paid_to_company }, undefined, undefined, FIELD_KEYS.vaFundingFee_d)}
        {renderFeeRow('', '', { others: FIELD_KEYS.hud900_custom1_others, broker: FIELD_KEYS.hud900_custom1_broker, apr: FIELD_KEYS.hud900_custom1_apr, paidToCompany: FIELD_KEYS.hud900_custom1_paid_to_company }, undefined, undefined, FIELD_KEYS.hud900_custom1_description)}
        {renderFeeRow('', '', { others: FIELD_KEYS.hud900_custom2_others, broker: FIELD_KEYS.hud900_custom2_broker, apr: FIELD_KEYS.hud900_custom2_apr, paidToCompany: FIELD_KEYS.hud900_custom2_paid_to_company }, undefined, undefined, FIELD_KEYS.hud900_custom2_description)}
      </div>

      {/* 1000 Reserves Deposited with Lender or Other */}
      <div className="space-y-0">
        <h3 className="font-semibold text-sm text-foreground underline mb-1">1000 – Reserves Deposited with Lender</h3>
        {renderInsuranceRow('1001', 'Hazard Insurance', FIELD_KEYS.hazardInsurance_months, FIELD_KEYS.hazardInsurance_perMonth, FIELD_KEYS.hazardInsurance_total, { others: FIELD_KEYS.hazardInsurance_others, broker: FIELD_KEYS.hazardInsurance_broker, apr: FIELD_KEYS.hazardInsurance_apr, paidToCompany: FIELD_KEYS.hazardInsurance_paid_to_company }, FIELD_KEYS.hazardInsurance_charge)}
        {renderInsuranceRow('1002', 'Mortgage Insurance', FIELD_KEYS.mortgageInsurance_months, FIELD_KEYS.mortgageInsurance_perMonth, FIELD_KEYS.mortgageInsurance_total, { others: FIELD_KEYS.mortgageInsurance_others, broker: FIELD_KEYS.mortgageInsurance_broker, apr: FIELD_KEYS.mortgageInsurance_apr, paidToCompany: FIELD_KEYS.mortgageInsurance_paid_to_company }, FIELD_KEYS.mortgageInsurance_charge)}
        {renderInsuranceRow('1004', 'Co. Property Taxes', FIELD_KEYS.coPropertyTaxes_months, FIELD_KEYS.coPropertyTaxes_perMonth, FIELD_KEYS.coPropertyTaxes_total, { others: FIELD_KEYS.coPropertyTaxes_others, broker: FIELD_KEYS.coPropertyTaxes_broker, apr: FIELD_KEYS.coPropertyTaxes_apr, paidToCompany: FIELD_KEYS.coPropertyTaxes_paid_to_company }, FIELD_KEYS.coPropertyTaxes_charge)}
      </div>

      {/* 1100 Title Charges */}
      <div className="space-y-0">
        <h3 className="font-semibold text-sm text-foreground underline mb-1">1100 – Title Charges</h3>
        {renderFeeRow('1101', 'Settlement or Closing/Escrow Fee', { others: FIELD_KEYS.settlementClosingFee_others, broker: FIELD_KEYS.settlementClosingFee_broker, apr: FIELD_KEYS.settlementClosingFee_apr, paidToCompany: FIELD_KEYS.settlementClosingFee_paid_to_company }, undefined, undefined, FIELD_KEYS.settlementClosingFee_d)}
        {renderFeeRow('1105', 'Document Preparation Fee', { others: FIELD_KEYS.docPreparationFee_others, broker: FIELD_KEYS.docPreparationFee_broker, apr: FIELD_KEYS.docPreparationFee_apr, paidToCompany: FIELD_KEYS.docPreparationFee_paid_to_company }, undefined, undefined, FIELD_KEYS.docPreparationFee_d)}
        {renderFeeRow('1106', 'Notary Fee', { others: FIELD_KEYS.notaryFee_others, broker: FIELD_KEYS.notaryFee_broker, apr: FIELD_KEYS.notaryFee_apr, paidToCompany: FIELD_KEYS.notaryFee_paid_to_company }, undefined, undefined, FIELD_KEYS.notaryFee_d)}
        {renderFeeRow('1108', 'Title Insurance', { others: FIELD_KEYS.titleInsurance_others, broker: FIELD_KEYS.titleInsurance_broker, apr: FIELD_KEYS.titleInsurance_apr, paidToCompany: FIELD_KEYS.titleInsurance_paid_to_company }, undefined, undefined, FIELD_KEYS.titleInsurance_d)}
        {renderFeeRow('', '', { others: FIELD_KEYS.hud1100_custom1_others, broker: FIELD_KEYS.hud1100_custom1_broker, apr: FIELD_KEYS.hud1100_custom1_apr, paidToCompany: FIELD_KEYS.hud1100_custom1_paid_to_company }, undefined, undefined, FIELD_KEYS.hud1100_custom1_description)}
        {renderFeeRow('', '', { others: FIELD_KEYS.hud1100_custom2_others, broker: FIELD_KEYS.hud1100_custom2_broker, apr: FIELD_KEYS.hud1100_custom2_apr, paidToCompany: FIELD_KEYS.hud1100_custom2_paid_to_company }, undefined, undefined, FIELD_KEYS.hud1100_custom2_description)}
      </div>

      {/* 1200 Government Recording and Transfer Charges */}
      <div className="space-y-0">
        <h3 className="font-semibold text-sm text-foreground underline mb-1">1200 – Government Recording and Transfer Charges</h3>
        {renderFeeRow('1201', 'Recording Fees', { others: FIELD_KEYS.recordingFees_others, broker: FIELD_KEYS.recordingFees_broker, apr: FIELD_KEYS.recordingFees_apr, paidToCompany: FIELD_KEYS.recordingFees_paid_to_company }, undefined, undefined, FIELD_KEYS.recordingFees_d)}
        {renderFeeRow('1202', 'City/County Tax/Stamps', { others: FIELD_KEYS.cityCountyTaxStamps_others, broker: FIELD_KEYS.cityCountyTaxStamps_broker, apr: FIELD_KEYS.cityCountyTaxStamps_apr, paidToCompany: FIELD_KEYS.cityCountyTaxStamps_paid_to_company }, undefined, undefined, FIELD_KEYS.cityCountyTaxStamps_d)}
      </div>

      {/* 1300 Additional Settlement Charges */}
      <div className="space-y-0">
        <h3 className="font-semibold text-sm text-foreground underline mb-1">1300 – Additional Settlement Charges</h3>
        {renderFeeRow('1302', 'Pest Inspection', { others: FIELD_KEYS.pestInspection_others, broker: FIELD_KEYS.pestInspection_broker, apr: FIELD_KEYS.pestInspection_apr, paidToCompany: FIELD_KEYS.pestInspection_paid_to_company }, undefined, undefined, FIELD_KEYS.pestInspection_d)}
      </div>

      {/* Subtotal and Total (auto-computed, read-only) */}
      <div className="space-y-1 pt-4 border-t-2 border-foreground">
        <div className="flex items-center gap-2 py-1">
          <div className="text-sm font-semibold text-foreground flex-1">Subtotal</div>
          <div className="relative w-28">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs pointer-events-none">$</span>
            <Input inputMode="decimal" value={formatCurrencyDisplay(grandTotal.toFixed(2))} readOnly disabled placeholder="0.00" className="h-7 text-xs text-right pl-5 bg-muted/50" />
          </div>
        </div>
        <div className="flex items-center gap-2 py-1">
          <div className="text-sm font-bold text-foreground flex-1">Total</div>
          <div className="relative w-28">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs font-bold pointer-events-none">$</span>
            <Input inputMode="decimal" value={formatCurrencyDisplay(grandTotal.toFixed(2))} readOnly disabled placeholder="0.00" className="h-7 text-xs text-right pl-5 font-bold bg-muted/50" />
          </div>
        </div>
      </div>


      {/* Compensation to Broker */}
      <div className="space-y-0">
        <h3 className="font-semibold text-sm text-foreground mb-1">Compensation to Broker (Not Paid Out of Loan Proceeds):</h3>
        {renderSimpleRow('Commission / Fees', FIELD_KEYS.commissionFees_d)}
        {renderSimpleRow('Additional Compensation from Lender', FIELD_KEYS.additionalCompensation_d)}
      </div>

      {/* Payment of Other Obligations */}
      <div className="space-y-0">
        <h3 className="font-semibold text-sm text-foreground underline mb-1">Payment of Other Obligations</h3>
        <DirtyFieldWrapper fieldKey={FIELD_KEYS.creditLifeDisabilityInsurance_label}>
          <div className="py-1 border-b border-border/50">
            <Input
              value={getValue(FIELD_KEYS.creditLifeDisabilityInsurance_label)}
              onChange={(e) => setValue(FIELD_KEYS.creditLifeDisabilityInsurance_label, e.target.value)}
              disabled={disabled}
              placeholder="Credit Life and/or Disability Insurance"
              className="h-7 text-xs"
            />
          </div>
        </DirtyFieldWrapper>
        {renderSimpleRow('Loan Documentation Fee', FIELD_KEYS.loanDocumentationFee_d)}
        {renderSimpleRow('', FIELD_KEYS.customOtherObligation_d, FIELD_KEYS.customOtherObligation_label)}
      </div>

      {/* Payment to Existing Liens */}
      <div className="space-y-0">
        <h3 className="font-semibold text-sm text-foreground underline mb-1">Payment to Existing Liens</h3>
        <p className="text-xs text-muted-foreground italic mb-1">Fills from data on "Properties"</p>
        {renderSimpleRow('', FIELD_KEYS.existingLien1_d, FIELD_KEYS.existingLien1_label)}
        {renderSimpleRow('', FIELD_KEYS.existingLien2_d, FIELD_KEYS.existingLien2_label)}
        {renderSimpleRow('', FIELD_KEYS.existingLien3_d, FIELD_KEYS.existingLien3_label)}
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* RE 885 – Proposed Loan Terms (Sections I–IX)              */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <RE885ProposedLoanTerms
        getValue={getValue}
        setValue={setValue}
        getBoolValue={getBoolValue}
        setBoolValue={setBoolValue}
        parseNumber={parseNumber}
        disabled={disabled}
        upstreamLoanAmount={loanAmountUpstream}
        upstreamInterestRate={loanRateUpstream}
        section800Total={section800Total}
        liensPayoffTotal={liensPayoffTotal}
      />

    </div>
  );
};

export default OriginationFeesForm;
