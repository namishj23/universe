const { Router } = require('express');

// Module B · Smart Campus Ride-Pooling (Person 1), ported from routepool2-react- @ 0c57429.
// CommonJS: the platform reaches this code only through the factory below.
module.exports = () => ({
  id: 'rides',
  label: 'Rides',
  order: 20,
  roles: ['student', 'mentor', 'driver', 'admin'],
  router: Router(),
});
