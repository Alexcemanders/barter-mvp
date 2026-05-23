import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { api } from '../api/client';
import { theme } from '../theme';

type RateItem = {
  display: string;
  unit: string;
  price: number;
};

type RatesMap = Record<string, RateItem>;

type Props = {
  navigation?: any;
  route?: any;
};

function clampQty(qty: number) {
  if (!Number.isFinite(qty)) return 1;
  if (qty < 1) return 1;
  return qty;
}

export default function ProposeTradeScreen(_props: Props) {
  const [rates, setRates] = useState<RatesMap>({});

  // Caller can pass these via navigation params.
  // route.params = { offeredKey, wantedKey, senderNote, sender_id, receiver_id, meeting fields }
  const offeredKey: string = _props.route?.params?.offeredKey ?? 'tomatoes';
  const wantedKey: string = _props.route?.params?.wantedKey ?? 'eggs';

  const [desiredQuantity, setDesiredQuantity] = useState<number>(1);

  // Scheduling state (replaces broken day increment logic)
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [meetingDateTime, setMeetingDateTime] = useState<Date>(() => new Date(Date.now() + 60 * 60 * 1000));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/market/rates');
        if (!cancelled) setRates((res.data ?? {}) as RatesMap);
      } catch {
        // Keep empty; UI falls back to defaults.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const offered = rates[offeredKey];
  const wanted = rates[wantedKey];

  // --- Evaluation summary (fail loudly; no pricing fallbacks) ---
  type EvaluationSummary = {
    error: boolean;
    offeredPrice: number;
    wantedPrice: number;
    giveQty: number;
    receivingUnit: string;
    receivingItem: string;
    givingUnit: string;
    givingItem: string;
  };

  const evaluationSummary: EvaluationSummary = useMemo(() => {
    const offeredKeyNorm = String(offeredKey ?? '').toLowerCase().trim();
    const wantedKeyNorm = String(wantedKey ?? '').toLowerCase().trim();

    const offeredRate = rates?.[offeredKeyNorm];
    const wantedRate = rates?.[wantedKeyNorm];

    const offeredPrice = offeredRate?.price;
    const wantedPrice = wantedRate?.price;

    const receivingItem = wantedRate?.display;
    const receivingUnit = wantedRate?.unit;

    const givingItem = offeredRate?.display;
    const givingUnit = offeredRate?.unit;

    const hasAll =
      typeof offeredPrice === 'number' && Number.isFinite(offeredPrice) &&
      typeof wantedPrice === 'number' && Number.isFinite(wantedPrice) &&
      typeof receivingItem === 'string' && receivingItem.trim().length > 0 &&
      typeof receivingUnit === 'string' && receivingUnit.trim().length > 0 &&
      typeof givingItem === 'string' && givingItem.trim().length > 0 &&
      typeof givingUnit === 'string' && givingUnit.trim().length > 0;

    if (!hasAll) {
      return {
        error: true,
        offeredPrice: NaN,
        wantedPrice: NaN,
        giveQty: NaN,
        receivingUnit: 'unit',
        receivingItem: wantedKeyNorm || 'item',
        givingUnit: 'unit',
        givingItem: offeredKeyNorm || 'item',
      };
    }

    const qty = clampQty(desiredQuantity);
    const raw = (wantedPrice * qty) / offeredPrice;
    const giveQty = Math.round(raw);

    return {
      error: false,
      offeredPrice,
      wantedPrice,
      giveQty,
      receivingUnit: receivingUnit!,
      receivingItem: receivingItem!,
      givingUnit,
      givingItem,
    };
  }, [rates, offeredKey, wantedKey, desiredQuantity]);

  const calculatedGiveQty = evaluationSummary.giveQty;
  const wanted_item = evaluationSummary.receivingItem;
  const wanted_unit = evaluationSummary.receivingUnit;
  const offered_item = evaluationSummary.givingItem;
  const offered_unit = evaluationSummary.givingUnit;


  const qty = clampQty(desiredQuantity);

  const items_receiving = useMemo(() => {
    return `${qty} ${wanted_unit} of ${wanted_item}`;
  }, [qty, wanted_unit, wanted_item]);

  const items_giving = useMemo(() => {
    return `${calculatedGiveQty} ${offered_unit} of ${offered_item}`;
  }, [calculatedGiveQty, offered_unit, offered_item]);

  const meetingDateString = useMemo(() => {
    return meetingDateTime.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  }, [meetingDateTime]);

  const hour24 = meetingDateTime.getHours();
  const minute = meetingDateTime.getMinutes();

  const proposed_time = useMemo(() => {
    // Backend payload expects: YYYY-MM-DD HH:MM:SS
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = meetingDateTime.getFullYear();
    const mm = pad(meetingDateTime.getMonth() + 1);
    const dd = pad(meetingDateTime.getDate());
    const HH = pad(hour24);
    const MM = pad(minute);
    const SS = '00';
    return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`;
  }, [meetingDateTime, hour24, minute]);

  const submitPayload = useMemo(() => {
    const senderNote = _props.route?.params?.senderNote ?? '';

    const sender_id: string = _props.route?.params?.sender_id;
    const receiver_id: string = _props.route?.params?.receiver_id;

    const meeting_name: string = _props.route?.params?.meeting_name ?? 'Meet here';
    const meeting_lat: number = _props.route?.params?.meeting_lat ?? 0;
    const meeting_lng: number = _props.route?.params?.meeting_lng ?? 0;

    return {
      sender_id,
      receiver_id,
      Sender_note: senderNote,
      items_giving,
      items_receiving,
      meeting_name,
      meeting_lat,
      meeting_lng,
      proposed_time,
    };
  }, [
    _props.route?.params,
    items_giving,
    items_receiving,
    proposed_time,
  ]);

  const onSend = async () => {
    try {
      if (evaluationSummary.error) {
        Alert.alert('Pricing error', 'Market rates missing for the selected items. Cannot send proposal.');
        return;
      }

      if (!submitPayload.sender_id || !submitPayload.receiver_id) {
        Alert.alert('Missing route data', 'sender_id/receiver_id not provided to ProposeTradeScreen.');
        return;
      }

      if (!String(submitPayload.Sender_note ?? '').trim()) {
        Alert.alert('Missing sender note', 'Please type how you can be recognized (Sender note) before sending.');
        return;
      }

      await api.post('/trades/propose', submitPayload);
      Alert.alert('Sent!', 'Your trade proposal was sent successfully.');
      _props.navigation?.goBack?.();
    } catch {
      Alert.alert('Error', 'Failed to send proposal.');
    }
  };

  return (
    <View style={styles.container}>
      {/* LIVE EXCHANGE CARD (kept minimal to avoid overflow) */}
      <Text style={styles.title}>Take-It-or-Leave-It Fair Exchange</Text>

      {/* LIVE VALUATION SUMMARY CARD */}
          <View style={styles.card}>
      <Text style={styles.cardTitle}>Live Trade Valuation Summary</Text>

      {evaluationSummary.error && (
        <Text style={[styles.errorText]}>
          Pricing error: missing marketRates for selected items.
        </Text>
      )}

      <View style={styles.ledgerRow}>
        <Text style={styles.ledgerLabel}>You Will Receive:</Text>
        <Text style={styles.ledgerValue}>
          {qty} {wanted_unit} of {wanted_item}
        </Text>
      </View>

      <View style={styles.ledgerDivider} />

      <View style={styles.ledgerRow}>
        <Text style={styles.ledgerLabel}>You Must Give:</Text>
        <Text style={styles.ledgerValue}>
          {calculatedGiveQty} {offered_unit} of {offered_item}
        </Text>
      </View>
    </View>


      {/* QUANTITY STEPPER */}
      <View style={styles.card}>
        <Text style={styles.panelLabel}>
          How many {wanted_unit} of {wanted_item} do you want?
        </Text>

        <View style={styles.stepperRow}>

          <TouchableOpacity
            onPress={() => setDesiredQuantity((q) => Math.max(1, q - 1))}
            style={styles.stepBtn}
            accessibilityRole="button"
            accessibilityLabel="Decrease desired quantity"
          >
            <Text style={styles.stepBtnText}>-</Text>
          </TouchableOpacity>

          <Text style={styles.stepperValue}>{qty}</Text>

          <TouchableOpacity
            onPress={() => setDesiredQuantity((q) => q + 1)}
            style={styles.stepBtn}
            accessibilityRole="button"
            accessibilityLabel="Increase desired quantity"
          >
            <Text style={styles.stepBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.divider} />

        <Text style={styles.secondaryText}>
          Payload preview:
          {'\n'}• items_receiving: {items_receiving}
          {'\n'}• items_giving: {items_giving}
        </Text>

        <Text style={styles.formulaText}>
          ⚖️ Equal Exchange math: Quantity_To_Give = Math.round((wanted_price * desired_qty) / offered_price)
        </Text>
      </View>

      {/* LOGISTICS & TIME SCHEDULER */}
      <View style={styles.card}>
        <Text style={styles.panelLabel}>Schedule a meetup</Text>

        {/* one-tap day picker */}
        <TouchableOpacity
          style={styles.datePickerButton}
          onPress={() => setDayPickerOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Choose day"
        >
          <Text style={styles.datePickerButtonText}>{meetingDateString}</Text>
        </TouchableOpacity>

        <Modal
          visible={dayPickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setDayPickerOpen(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Pick a day</Text>
              <View style={styles.dayPickerGrid}>
                {(() => {
                  const base = new Date(meetingDateTime);
                  const day0 = new Date(base.getFullYear(), base.getMonth(), base.getDate());
                  const days = Array.from({ length: 14 }).map((_, i) => {
                    const d = new Date(day0);
                    d.setDate(day0.getDate() + i);
                    return d;
                  });

                  const current = new Date(meetingDateTime);
                  return days.map((d) => {
                    const active = d.toDateString() === current.toDateString();
                    return (
                      <TouchableOpacity
                        key={d.toISOString()}
                        style={[styles.dayChip, active ? styles.dayChipActive : undefined]}
                        onPress={() => {
                          setMeetingDateTime((prev) => {
                            const next = new Date(prev);
                            next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                            return next;
                          });
                          setDayPickerOpen(false);
                        }}
                      >
                        <Text style={[styles.dayChipText, active ? styles.dayChipTextActive : undefined]}>
                          {d.toLocaleDateString(undefined, { weekday: 'short' })}
                        </Text>
                        <Text style={[styles.dayChipText, active ? styles.dayChipTextActive : undefined]}>
                          {d.getDate()}
                        </Text>
                      </TouchableOpacity>
                    );
                  });
                })()}
              </View>

              <TouchableOpacity style={styles.dayPickerClose} onPress={() => setDayPickerOpen(false)}>
                <Text style={styles.dayPickerCloseText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* hour/minute steppers in 24h format */}
        <View style={styles.timeRow}>
          <View style={styles.timeStepperCol}>
            <Text style={styles.timeLabel}>Hour</Text>
            <View style={styles.smallStepperRow}>
              <TouchableOpacity
                style={[styles.smallBtn, styles.ghostBtn]}
                onPress={() => {
                  setMeetingDateTime((d) => {
                    const next = new Date(d);
                    next.setHours((next.getHours() + 23) % 24);
                    return next;
                  });
                }}
                accessibilityRole="button"
                accessibilityLabel="Decrease hour"
              >
                <Text style={styles.smallBtnText}>-</Text>
              </TouchableOpacity>

              <Text style={styles.timeValue}>{String(hour24).padStart(2, '0')}</Text>

              <TouchableOpacity
                style={[styles.smallBtn, styles.ghostBtn]}
                onPress={() => {
                  setMeetingDateTime((d) => {
                    const next = new Date(d);
                    next.setHours((next.getHours() + 1) % 24);
                    return next;
                  });
                }}
                accessibilityRole="button"
                accessibilityLabel="Increase hour"
              >
                <Text style={styles.smallBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.timeStepperCol}>
            <Text style={styles.timeLabel}>Minute</Text>
            <View style={styles.smallStepperRow}>
              <TouchableOpacity
                style={[styles.smallBtn, styles.ghostBtn]}
                onPress={() => {
                  setMeetingDateTime((d) => {
                    const next = new Date(d);
                    next.setMinutes((next.getMinutes() + 59) % 60);
                    return next;
                  });
                }}
                accessibilityRole="button"
                accessibilityLabel="Decrease minute"
              >
                <Text style={styles.smallBtnText}>-</Text>
              </TouchableOpacity>

              <Text style={styles.timeValue}>{String(minute).padStart(2, '0')}</Text>

              <TouchableOpacity
                style={[styles.smallBtn, styles.ghostBtn]}
                onPress={() => {
                  setMeetingDateTime((d) => {
                    const next = new Date(d);
                    next.setMinutes((next.getMinutes() + 1) % 60);
                    return next;
                  });
                }}
                accessibilityRole="button"
                accessibilityLabel="Increase minute"
              >
                <Text style={styles.smallBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <Text style={styles.proposedTimeText}>proposed_time: {proposed_time}</Text>
      </View>

      {/* ACTION BUTTON */}
      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={() => void onSend()}
        accessibilityRole="button"
      >
        <Text style={styles.primaryBtnText}>Send Sealed Proposal Offer</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: theme.colors.bg, gap: 12 },
  title: { fontSize: 22, fontWeight: '900', color: theme.colors.text, marginTop: 6 },

  card: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },

  cardTitle: { fontWeight: '900', fontSize: 16, color: theme.colors.text },

  panelLabel: { fontWeight: '900', color: theme.colors.muted },

  ledgerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  ledgerLabel: { fontWeight: '900', color: theme.colors.muted, flex: 1 },
  ledgerValue: { fontWeight: '900', color: theme.colors.text, textAlign: 'right', flex: 1.2 },
  ledgerDivider: { height: 1, backgroundColor: theme.colors.border },

  divider: { height: 1, backgroundColor: theme.colors.border },

  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  stepBtn: {
    width: 68,
    height: 68,
    borderRadius: 18,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  stepBtnText: { fontSize: 34, fontWeight: '900', color: '#fff' },
  stepperValue: { fontSize: 34, fontWeight: '900', color: theme.colors.text, width: 72, textAlign: 'center' },


  formulaText: { color: theme.colors.muted, fontWeight: '800', fontSize: 12, lineHeight: 18 },

  secondaryText: { color: theme.colors.text, fontWeight: '800', fontSize: 13, lineHeight: 18 },

  primaryBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.primary,
    marginTop: 4,
  },
  primaryBtnText: { color: '#fff', fontWeight: '900', fontSize: 16 },

  errorText: { color: '#b91c1c', fontWeight: '900', marginTop: 6 },

  datePickerButton: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  datePickerButtonText: { fontWeight: '900', color: theme.colors.text },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  modalTitle: { fontWeight: '900', fontSize: 18, color: theme.colors.text },

  dayPickerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayChip: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  dayChipActive: { borderColor: theme.colors.primary, backgroundColor: '#ecfdf5' },
  dayChipText: { fontWeight: '900', color: theme.colors.text },
  dayChipTextActive: { color: theme.colors.primaryDark },

  dayPickerClose: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: theme.colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    width: '100%',
  },
  dayPickerCloseText: { fontWeight: '900', color: theme.colors.primaryDark },

  timeRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  timeStepperCol: { flex: 1 },
  timeLabel: { fontWeight: '900', color: theme.colors.muted, marginBottom: 8 },
  smallStepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },

  smallBtn: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 56,
  },
  smallBtnText: { fontWeight: '900', color: theme.colors.text },
  ghostBtn: { backgroundColor: theme.colors.card },

  timeValue: { fontWeight: '900', color: theme.colors.text, fontSize: 20, minWidth: 52, textAlign: 'center' },

  proposedTimeText: { fontWeight: '900', color: theme.colors.muted, marginTop: 8 },
});

