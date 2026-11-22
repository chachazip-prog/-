import type Phaser from 'phaser';

/** 회색 박스 단계 임시 텍스트 스타일. 한글 도트 폰트(비트맵) 확정 시 교체 */
export const TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'sans-serif',
  fontSize: '12px',
  color: '#f0f0f0',
  align: 'center',
};
