import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { Colors, FontFamily } from '@/constants/theme';

/** Ba tab chính. Các màn đẩy lên từ tab (tìm kiếm, bản đồ, lịch trình) nằm ở Stack cha nên che thanh tab. */
export default function TabsLayout() {
  return (
    <NativeTabs tintColor={Colors.light.primary} labelStyle={{ fontFamily: FontFamily.medium }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Khám phá</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'map', selected: 'map.fill' }} md="explore" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="trips">
        <NativeTabs.Trigger.Label>Chuyến đi</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'suitcase', selected: 'suitcase.fill' }} md="luggage" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Label>Tài khoản</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'person.crop.circle', selected: 'person.crop.circle.fill' }} md="account_circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
