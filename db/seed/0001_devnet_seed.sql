-- =====================================================================
-- FILE106 ARCHIVE — devnet seed (Stage 1)
--
-- Apply after the migration:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seed/0001_devnet_seed.sql
--
-- EVERYTHING HERE IS TEST MATERIAL.
--   * passwords are archive-admin-dev / archive-user-dev
--   * puzzle answers are classified / redacted / 106 / gaslight
--   * wallet addresses were generated from discarded random bytes; no private
--     keys exist for them, so nothing here can hold or move real F106
--   * the answer ciphertext below was sealed with the public dev key
--     f106a5e1c0de0000f106a5e1c0de0000f106a5e1c0de0000f106a5e1c0de0000
--     and decrypts to "classified"
--
-- Never run this against a database that holds real participants.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Staff and participants
-- ---------------------------------------------------------------------
insert into admin_users (id, email, display_name, password_hash, role) values
  ('a0000000-0000-4000-8000-000000000001', 'admin@file106.local', 'ARCHIVIST',
   'scrypt$32768$8$1$5Hgv_tSMW9sVOeZyRud9MQ$RCye_SpeEgMnwpJ6xw40UQgcinsRnHWteJurOVx_yS0', 'owner')
on conflict do nothing;

insert into users (id, username, email, password_hash, status, email_verified_at, terms_accepted_at) values
  ('b0000000-0000-4000-8000-000000000001', 'redacted_one', 'redacted_one@file106.local',
   'scrypt$32768$8$1$Dryr5r-_nGnG-INs719Fpw$YZnuAw1V-isRt9wCeuUzTGWVuEALQbGzAzTtM4mF1a0',
   'active', now(), now()),
  ('b0000000-0000-4000-8000-000000000002', 'ghost_archive', 'ghost_archive@file106.local',
   'scrypt$32768$8$1$Dryr5r-_nGnG-INs719Fpw$YZnuAw1V-isRt9wCeuUzTGWVuEALQbGzAzTtM4mF1a0',
   'active', now(), now())
on conflict do nothing;

insert into user_wallets (user_id, address, is_primary, proof_nonce, proof_message, proof_signature, first_seen_balance_f106) values
  ('b0000000-0000-4000-8000-000000000001', 'GiWB1FoFaWEY8FgdYTD2yureHfktKvAZgwut4dZf4u1R', true,
   'seed-nonce-a', 'FILE106 ARCHIVE | link wallet | seed-nonce-a',
   '5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJSUgBEig8at6vBzZ7bNhQjRcKBzaZobPCNoAap',
   1.5),
  ('b0000000-0000-4000-8000-000000000002', '8zaiNx6CLFhHHEfFTN1nAkHWwPHDvKazmMHcbwRtQ8df', true,
   'seed-nonce-b', 'FILE106 ARCHIVE | link wallet | seed-nonce-b',
   '5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJSUgBEig8at6vBzZ7bNhQjRcKBzaZobPCNoAap',
   2)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Archive files
-- ---------------------------------------------------------------------
insert into files (
  id, file_number, slug, title, teaser, briefing, difficulty, status, reward_amount_f106,
  min_holding_f106, winner_method, max_winners, opens_at, closes_at, created_by
) values
  ('f1060000-0000-4000-8000-000000000106', 106, 'file-106', 'THE FIRST ENTRY',
   'One file was never supposed to leave the vault. Its index card is still warm.',
   'The first record in the archive. The seal is broken. Read the residue, not the words.',
   'easy', 'open', 0.75, 1, 'first_correct', 1,
   now() - interval '2 days', now() + interval '28 days',
   'a0000000-0000-4000-8000-000000000001'),

  ('f1060000-0000-4000-8000-000000000107', 107, 'file-107', 'MARGIN NOTES',
   'Someone annotated the file in the same ink as the signature. The signature is missing.',
   'A second copy exists. Find which copy was written last.',
   'medium', 'open', 0.27, 1, 'limited_winners', 3,
   now() - interval '1 day', now() + interval '21 days',
   'a0000000-0000-4000-8000-000000000001'),

  ('f1060000-0000-4000-8000-000000000108', 108, 'file-108', 'PARTNER TRANSMISSION',
   'The file arrived through a partner channel. Its reward is being negotiated.',
   'Cross-reference the partner record with the transmission log.',
   'hard', 'locked', 0, 1, 'admin_selected', 1,
   now() + interval '3 days', now() + interval '31 days',
   'a0000000-0000-4000-8000-000000000001'),

  ('f1060000-0000-4000-8000-000000000109', 109, 'file-109', 'SEALED STACK',
   'Ten pages. Nine are decoys. One requires a larger holding to open.',
   'Restricted. Holding requirement not yet met by the current custodian.',
   'brutal', 'locked', 0.5, 2, 'time_limited', null,
   now() + interval '10 days', now() + interval '40 days',
   'a0000000-0000-4000-8000-000000000001')
on conflict do nothing;

insert into challenges (id, file_id, position, prompt, answer_hash, answer_format) values
  ('c1060000-0000-4000-8000-000000000106', 'f1060000-0000-4000-8000-000000000106', 1,
   'The stamp on the folder reads 106/106. What classification was stamped underneath?',
   'scrypt$32768$8$1$lAdc9sLdUY9pbGnn32ExUw$_VyIT-ClO1qhUC0Zkr4ZIbAmj44rXj1ZwucKGPFwN0U', 'text'),
  ('c1060000-0000-4000-8000-000000000107', 'f1060000-0000-4000-8000-000000000107', 1,
   'Only one word on page 107 survived the ink. It is not a word of the report.',
   'scrypt$32768$8$1$kKaVmNRKa6Y-rr6Ef3x5jA$QnsJonVbAwut6cnmw4wU6-ABpbiaTT1knyQ3-UHVvXQ', 'text'),
  ('c1060000-0000-4000-8000-000000000108', 'f1060000-0000-4000-8000-000000000108', 1,
   'The partner transmission repeats the archive number. Which number?',
   'scrypt$32768$8$1$rLnbW5bNyteT99WHImFOAw$tAkwZuhmE88zHR8cJYTLJqMZv5A7EGw76svoEYObVSc', 'numeric'),
  ('c1060000-0000-4000-8000-000000000109', 'f1060000-0000-4000-8000-000000000109', 1,
   'Nine decoys describe the same event. Name the operation the tenth one hides.',
   'scrypt$32768$8$1$4-xvJDsukzzBYDknn4Ypcw$Q_j5l6N_b9vMuBSE79V8EIIG_qtTPCt6UOnhBJCkL4k', 'text')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Partnership campaign
-- ---------------------------------------------------------------------
insert into partnerships (id, partner_name, x_username, x_url, telegram_username, telegram_url, created_by) values
  ('d0000000-0000-4000-8000-000000000001', 'Example Project', 'exampleproject',
   'https://x.com/exampleproject', 'exampleproject', 'https://t.me/exampleproject',
   'a0000000-0000-4000-8000-000000000001')
on conflict do nothing;

insert into partnership_campaigns (
  id, slug, title, partnership_id, file_id, description, rules_md, reward_amount_f106,
  min_holding_f106, winners_count, status, starts_at, ends_at, created_by
) values
  ('e0000000-0000-4000-8000-000000000001', 'transmission-108', 'PARTNERSHIP FILE108',
   'd0000000-0000-4000-8000-000000000001', 'f1060000-0000-4000-8000-000000000108',
   'A joint transmission with Example Project. Complete the requirements, then open FILE108.',
   'Rewards are paid manually after admin verification. Holding requirements are checked on-chain.',
   0.4, 1, 2, 'draft',
   now() + interval '3 days', now() + interval '24 days',
   'a0000000-0000-4000-8000-000000000001')
on conflict do nothing;

-- X follows are seeded as manual: no paid X API access is assumed. The
-- Telegram task is auto-eligible once the bot is configured in Stage 6.
insert into campaign_tasks (id, campaign_id, kind, label, target, target_url, verification_mode, position) values
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
   'x_follow', 'Follow FILE106 on X', 'file106', 'https://x.com/file106', 'manual', 1),
  ('e1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000001',
   'x_follow', 'Follow Example Project on X', 'exampleproject',
   'https://x.com/exampleproject', 'manual', 2),
  ('e1000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001',
   'telegram_join', 'Join the Example Project Telegram', '-1000000000000',
   'https://t.me/exampleproject', 'manual', 3),
  ('e1000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000001',
   'archive_solve', 'Solve FILE108', 'file-108', '/archive/file-108', 'auto', 4)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Sample activity: one pending submission, one approved winner awaiting manual
-- payment. No transaction row exists, which is exactly the state a real payout
-- starts in.
-- ---------------------------------------------------------------------
insert into submissions (
  id, file_id, challenge_id, user_id, wallet_address, answer_ciphertext, answer_digest,
  status, holding_checked_at, holding_snapshot_f106, holding_required_f106, holding_satisfied, balance_slot
) values
  ('aa000000-0000-4000-8000-000000000001', 'f1060000-0000-4000-8000-000000000106',
   'c1060000-0000-4000-8000-000000000106', 'b0000000-0000-4000-8000-000000000001',
   'GiWB1FoFaWEY8FgdYTD2yureHfktKvAZgwut4dZf4u1R',
   decode('2ea247bbd12945d7b772250b6d33979f0f02417547d83637d3b2a03df711b617c777133b01cf', 'hex'),
   decode('0ec2f7dbd9f12f8975b10306ae32f0bb5516b2ff7dcc703711e496c344991ab3', 'hex'),
   'pending_review', now(), 1.5, 1, true, 100000000),

  ('aa000000-0000-4000-8000-000000000002', 'f1060000-0000-4000-8000-000000000107',
   'c1060000-0000-4000-8000-000000000107', 'b0000000-0000-4000-8000-000000000002',
   '8zaiNx6CLFhHHEfFTN1nAkHWwPHDvKazmMHcbwRtQ8df',
   decode('2ea247bbd12945d7b772250b6d33979f0f02417547d83637d3b2a03df711b617c777133b01cf', 'hex'),
   decode('0ec2f7dbd9f12f8975b10306ae32f0bb5516b2ff7dcc703711e496c344991ab3', 'hex'),
   'approved', now(), 2, 1, true, 100000100)
on conflict do nothing;

insert into winners (
  id, file_id, submission_id, user_id, wallet_address, reward_amount_f106, status,
  selected_by, selected_at, approved_by, approved_at
) values
  ('ab000000-0000-4000-8000-000000000001', 'f1060000-0000-4000-8000-000000000107',
   'aa000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002',
   '8zaiNx6CLFhHHEfFTN1nAkHWwPHDvKazmMHcbwRtQ8df', 0.27, 'approved',
   'a0000000-0000-4000-8000-000000000001', now(),
   'a0000000-0000-4000-8000-000000000001', now())
on conflict do nothing;

insert into rewards (
  id, winner_id, user_id, wallet_address, file_id, file_number, amount_f106,
  payment_status, approved_by, approved_at
) values
  ('ac000000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000002', '8zaiNx6CLFhHHEfFTN1nAkHWwPHDvKazmMHcbwRtQ8df',
   'f1060000-0000-4000-8000-000000000107', 107, 0.27,
   'awaiting_payment', 'a0000000-0000-4000-8000-000000000001', now())
on conflict do nothing;

insert into user_campaign_progress (
  user_id, campaign_id, registered_at, wallet_connected_at, balance_verified_at,
  balance_snapshot_f106, tasks_required, tasks_verified, is_eligible, eligible_at
) values
  ('b0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
   now(), now(), now(), 1.5, 4, 1, false, null)
on conflict do nothing;

commit;
