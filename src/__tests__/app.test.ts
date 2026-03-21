describe('App', () => {
  describe('Basic Tests', () => {
    it('should pass basic assertion', () => {
      expect(1 + 1).toBe(2);
    });

    it('should handle string operations', () => {
      const name = 'SubTrackr';
      expect(name).toContain('Sub');
    });

    it('should work with arrays', () => {
      const subs = ['Netflix', 'Spotify', 'Gym'];
      expect(subs).toHaveLength(3);
      expect(subs).toContain('Netflix');
    });
  });
});
