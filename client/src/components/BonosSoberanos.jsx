import BondPage from './BondPage';
export default function BonosSoberanos() {
  return <BondPage config={{ dbRoute: 'soberanos', apiType: 'BONOS', settlement: 'A-48HS', settingsKey: 'sob_column_order', showPaymentMonths: false, collapsibleSearch: true, title: 'BONOS SOBERANOS ARGENTINA', flyerTitle: 'BONOS SOBERANOS ARGENTINA' }} />;
}
