import BondPage from './BondPage';
export default function BonosSubsoberanos() {
  return <BondPage config={{ dbRoute: 'subsoberanos', apiType: 'BONOS', settlement: 'A-48HS', settingsKey: 'sub_column_order', showPaymentMonths: false, collapsibleSearch: true, title: 'BONOS SUBSOBERANOS ARGENTINA', flyerTitle: 'BONOS SUBSOBERANOS ARGENTINA' }} />;
}
