begin;

alter table if exists estate_service_configs
  drop constraint if exists estate_service_configs_key_check;
alter table if exists home_service_accounts
  drop constraint if exists home_service_accounts_key_check;
alter table if exists home_service_assignments
  drop constraint if exists home_service_assignments_key_check;
alter table if exists service_provider_transactions
  drop constraint if exists service_provider_transactions_key_check;

alter table if exists estate_service_configs
  add constraint estate_service_configs_key_check
  check (service_key in (
    'utility_token',
    'water_service',
    'gas_service',
    'internet_service',
    'fiber_internet',
    'generator_recovery',
    'solar_battery_service',
    'service_charge',
    'other_facility_fees'
  ));

alter table if exists home_service_accounts
  add constraint home_service_accounts_key_check
  check (service_key in (
    'utility_token',
    'water_service',
    'gas_service',
    'internet_service',
    'fiber_internet',
    'generator_recovery',
    'solar_battery_service',
    'service_charge',
    'other_facility_fees'
  ));

alter table if exists home_service_assignments
  add constraint home_service_assignments_key_check
  check (service_key in (
    'utility_token',
    'water_service',
    'gas_service',
    'internet_service',
    'fiber_internet',
    'generator_recovery',
    'solar_battery_service',
    'service_charge',
    'other_facility_fees'
  ));

alter table if exists service_provider_transactions
  add constraint service_provider_transactions_key_check
  check (service_key in (
    'utility_token',
    'water_service',
    'gas_service',
    'internet_service',
    'fiber_internet',
    'generator_recovery',
    'solar_battery_service',
    'service_charge',
    'other_facility_fees'
  ));

commit;
