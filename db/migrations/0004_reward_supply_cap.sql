-- =====================================================================
-- No reward or holding requirement can exceed the supply.
--
-- FILE106 was minted at 106 units and the mint authority was revoked, so 106
-- is the entire supply and always will be. A reward of 250 F106 is not a
-- generous number, it is an impossible one: paying it would require more than
-- twice the tokens that exist. A holding requirement above 106 is equally
-- unsatisfiable — nobody can hold a balance the chain cannot produce.
--
-- The admin editor rejects both before they reach Postgres. These constraints
-- are the backstop for seeds, scripts, and anything written later.
-- =====================================================================

alter table files
  add constraint files_reward_within_supply
    check (reward_amount_f106 <= 106),
  add constraint files_min_holding_within_supply
    check (min_holding_f106 <= 106);

alter table partnership_campaigns
  add constraint campaigns_reward_within_supply
    check (reward_amount_f106 <= 106),
  add constraint campaigns_min_holding_within_supply
    check (min_holding_f106 <= 106);
